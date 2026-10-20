// Archery (task 22): turn-based, one shared target, eight stages that get
// farther and windier. Pure and deterministic (seed + input stream): the
// server runs it, the client's preview runs `predictHit` with no wind.
//
// Axes: the shooter stands at the origin looking down -z; +x is their right,
// +y is up. The target face is a disc in the plane z = -distance.

export type Seat = 0 | 1;

export const DT = 1 / 60;
export const GRAVITY = 9.81;
/** Where the arrow leaves the bow. */
export const LAUNCH = { y: 1.5 } as const;
/** The target face: centre height and radius (a 122 cm face). */
export const TARGET = { centerY: 1.3, radius: 0.61 } as const;
/** Ten rings, 10 at the centre; inside half the 10 ring is the bullseye. */
export const RINGS = 10;
export const BULLSEYE_POINTS = 11;
/** Arrow speed from draw 0..1; a full draw flies flatter and drifts less. */
export const SPEED = { min: 30, max: 60 } as const;
/** A release drawn less than this is ignored; the client cancels instead. */
export const MIN_DRAW = 0.2;
/** Wind pushes the arrow sideways (and along) by this much per m/s of wind. */
export const WIND_ACCEL = 0.4;
/** Aim limits, radians: yaw + is right, pitch + is up. */
export const AIM = { yaw: 0.35, pitchMin: -0.2, pitchMax: 0.6 } as const;

/** The match's stages: distance in metres and the strongest wind (m/s). */
export const STAGES: readonly { distance: number; maxWind: number }[] = [
  { distance: 10, maxWind: 0 },
  { distance: 15, maxWind: 1 },
  { distance: 20, maxWind: 2 },
  { distance: 25, maxWind: 3 },
  { distance: 30, maxWind: 4 },
  { distance: 35, maxWind: 5 },
  { distance: 40, maxWind: 6 },
  { distance: 50, maxWind: 8 },
];
/** Sudden death (a tie after the stages) is at the last stage's distance and wind. */
export const SUDDEN_DEATH = STAGES.length;

/** Seconds a shooter has before the arrow is lost; keeps an idle player from stalling the room. */
export const SHOT_CLOCK_TICKS = 30 * 60;
/** How long the landed arrow stays on screen before the next turn. */
export const RESULT_TICKS = 90;
/** A finished practice match stays up this long before the next starts. */
export const OVER_TICKS = 240;
/** Flights longer than this (they can't be, in range) are lost. */
const MAX_FLIGHT_TICKS = 600;

export type Format = "stages" | "unlimited";

/**
 * Wind: `speed` m/s, blowing toward `angle` radians, measured from the
 * shooter's right (0) round to downrange (pi/2), left (pi) and back at the
 * shooter (3pi/2).
 */
export interface Wind {
  speed: number;
  angle: number;
}

export interface Aim {
  yaw: number;
  pitch: number;
  draw: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Where an arrow met the target plane, relative to the centre; null if it never got there. */
export interface Hit {
  x: number;
  y: number;
}

export interface Shot {
  seat: Seat;
  stage: number;
  distance: number;
  hit: Hit | null;
  points: number;
  bullseye: boolean;
  /** Why it scored nothing without reaching the face: ran out of time, or fell short. */
  lost?: "time" | "short";
}

export type Phase = "aim" | "flight" | "result" | "over";

export interface ArcheryState {
  tick: number;
  format: Format;
  /** Practice: a finished match starts a fresh one. */
  endless: boolean;
  phase: Phase;
  phaseTick: number;
  /** 0..7, or SUDDEN_DEATH; in unlimited, the level this turn was drawn from. */
  stage: number;
  distance: number;
  wind: Wind;
  turn: Seat;
  /** Shots taken in this stage (two closes it). */
  turnInStage: number;
  /** The shooter's sight and draw as they last sent it, for others to watch. */
  aim: Aim;
  arrow: { pos: Vec3; vel: Vec3; ticks: number } | null;
  /** This match's shots (unlimited keeps the latest 20). */
  shots: Shot[];
  totals: [number, number];
  /** Unlimited: arrows shot and the best single arrow, per seat. */
  best: [number, number];
  winner: Seat | null;
  /** Matches finished in this game (practice runs several). */
  matches: number;
  rng: number;
}

export type ArcherySnapshot = Omit<ArcheryState, "rng">;

export type ArcheryInput =
  | { t: "aim"; seat: Seat; yaw: number; pitch: number; draw: number }
  | { t: "release"; seat: Seat; yaw: number; pitch: number; draw: number };

export type ArcheryEvent =
  | { type: "shot"; seat: Seat; points: number; bullseye: boolean; stage: number; lost?: "time" | "short" }
  | { type: "stage"; stage: number; distance: number; wind: Wind }
  | { type: "match"; winner: Seat; score: [number, number] };

export const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function clampAim(a: Aim): Aim {
  return {
    yaw: clamp(a.yaw, -AIM.yaw, AIM.yaw),
    pitch: clamp(a.pitch, AIM.pitchMin, AIM.pitchMax),
    draw: clamp(a.draw, 0, 1),
  };
}

function random(s: ArcheryState): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const arrowSpeed = (draw: number): number => SPEED.min + clamp(draw, 0, 1) * (SPEED.max - SPEED.min);

/** The wind's push on the arrow, m/s^2, in world axes. */
export function windAccel(w: Wind): { x: number; z: number } {
  return { x: WIND_ACCEL * w.speed * Math.cos(w.angle), z: -WIND_ACCEL * w.speed * Math.sin(w.angle) };
}

export function launch(aim: Aim): { pos: Vec3; vel: Vec3 } {
  const a = clampAim(aim);
  const v = arrowSpeed(a.draw);
  return {
    pos: { x: 0, y: LAUNCH.y, z: 0 },
    vel: { x: v * Math.cos(a.pitch) * Math.sin(a.yaw), y: v * Math.sin(a.pitch), z: -v * Math.cos(a.pitch) * Math.cos(a.yaw) },
  };
}

type Flight = { kind: "flying" } | { kind: "hit"; hit: Hit } | { kind: "short" };

/**
 * One tick of flight, in place. The server steps this every tick and the
 * preview loops it, so with the same wind they land on the same spot.
 */
export function flyStep(arrow: { pos: Vec3; vel: Vec3 }, distance: number, w: Wind): Flight {
  const acc = windAccel(w);
  const prev = { ...arrow.pos };
  arrow.vel.x += acc.x * DT;
  arrow.vel.y -= GRAVITY * DT;
  arrow.vel.z += acc.z * DT;
  arrow.pos.x += arrow.vel.x * DT;
  arrow.pos.y += arrow.vel.y * DT;
  arrow.pos.z += arrow.vel.z * DT;
  const plane = -distance;
  if (arrow.pos.z <= plane) {
    const f = (prev.z - plane) / (prev.z - arrow.pos.z);
    const y = prev.y + f * (arrow.pos.y - prev.y);
    if (y <= 0) return { kind: "short" };
    const x = prev.x + f * (arrow.pos.x - prev.x);
    arrow.pos = { x, y, z: plane };
    return { kind: "hit", hit: { x, y: y - TARGET.centerY } };
  }
  if (arrow.pos.y <= 0) return { kind: "short" };
  return { kind: "flying" };
}

/** Where `aim` would meet the target plane at `distance` in `wind` (none by default). */
export function predictHit(aim: Aim, distance: number, w: Wind = { speed: 0, angle: 0 }): Hit | null {
  const arrow = launch(aim);
  for (let i = 0; i < MAX_FLIGHT_TICKS; i++) {
    const r = flyStep(arrow, distance, w);
    if (r.kind === "hit") return r.hit;
    if (r.kind === "short") return null;
  }
  return null;
}

/** The arc `aim` would fly with no wind, every few ticks, for drawing. */
export function previewPath(aim: Aim, distance: number, every = 3): Vec3[] {
  const arrow = launch(aim);
  const path: Vec3[] = [{ ...arrow.pos }];
  for (let i = 1; i < MAX_FLIGHT_TICKS; i++) {
    const r = flyStep(arrow, distance, { speed: 0, angle: 0 });
    if (r.kind !== "flying" || i % every === 0) path.push({ ...arrow.pos });
    if (r.kind !== "flying") break;
  }
  return path;
}

/** Points for a hit: 10 rings, the inner half of the 10 is the bullseye. */
export function scoreHit(hit: Hit | null): { points: number; bullseye: boolean } {
  if (!hit) return { points: 0, bullseye: false };
  const r = Math.hypot(hit.x, hit.y);
  const ring = TARGET.radius / RINGS;
  if (r > TARGET.radius) return { points: 0, bullseye: false };
  if (r <= ring / 2) return { points: BULLSEYE_POINTS, bullseye: true };
  return { points: Math.min(RINGS, RINGS - Math.floor(r / ring)), bullseye: false };
}

/** Sudden death: nearer the centre wins; an arrow off the face is infinitely far. */
const closeness = (shot: Shot): number => (shot.hit && shot.points > 0 ? Math.hypot(shot.hit.x, shot.hit.y) : Infinity);

function rollWind(s: ArcheryState, maxWind: number): Wind {
  if (maxWind <= 0) return { speed: 0, angle: 0 };
  const speed = maxWind * (0.5 + 0.5 * random(s));
  return { speed: Math.round(speed * 10) / 10, angle: random(s) * Math.PI * 2 };
}

const firstShooter = (stage: number): Seat => (stage % 2 === 0 ? 0 : 1);

/** Starts `stage` (or, in unlimited, a fresh random level). The wind is one roll for both arrows. */
function startStage(s: ArcheryState, stage: number, ev: ArcheryEvent[]): void {
  const level = s.format === "unlimited" ? Math.floor(random(s) * STAGES.length) : Math.min(stage, STAGES.length - 1);
  s.stage = s.format === "unlimited" ? level : stage;
  s.distance = STAGES[level].distance;
  s.wind = rollWind(s, STAGES[level].maxWind);
  s.turnInStage = 0;
  if (s.format !== "unlimited") s.turn = firstShooter(stage);
  startTurn(s);
  ev.push({ type: "stage", stage: s.stage, distance: s.distance, wind: { ...s.wind } });
}

function startTurn(s: ArcheryState): void {
  s.phase = "aim";
  s.phaseTick = 0;
  s.arrow = null;
  s.aim = { yaw: 0, pitch: 0, draw: 0 };
}

export interface StateOptions {
  format?: Format;
  endless?: boolean;
}

function freshMatch(s: ArcheryState, ev: ArcheryEvent[]): void {
  s.shots = [];
  s.totals = [0, 0];
  s.best = [0, 0];
  s.winner = null;
  s.turn = 0;
  startStage(s, 0, ev);
}

export function createState(seed: number, options: StateOptions = {}): ArcheryState {
  const s: ArcheryState = {
    tick: 0,
    format: options.format ?? "stages",
    endless: options.endless ?? false,
    phase: "aim",
    phaseTick: 0,
    stage: 0,
    distance: STAGES[0].distance,
    wind: { speed: 0, angle: 0 },
    turn: 0,
    turnInStage: 0,
    aim: { yaw: 0, pitch: 0, draw: 0 },
    arrow: null,
    shots: [],
    totals: [0, 0],
    best: [0, 0],
    winner: null,
    matches: 0,
    rng: seed >>> 0,
  };
  freshMatch(s, []);
  return s;
}

export function snapshot(s: ArcheryState): ArcherySnapshot {
  return {
    tick: s.tick,
    format: s.format,
    endless: s.endless,
    phase: s.phase,
    phaseTick: s.phaseTick,
    stage: s.stage,
    distance: s.distance,
    wind: { ...s.wind },
    turn: s.turn,
    turnInStage: s.turnInStage,
    aim: { ...s.aim },
    arrow: s.arrow ? { pos: { ...s.arrow.pos }, vel: { ...s.arrow.vel }, ticks: s.arrow.ticks } : null,
    shots: s.shots.map((sh) => ({ ...sh, hit: sh.hit ? { ...sh.hit } : null })),
    totals: [s.totals[0], s.totals[1]],
    best: [s.best[0], s.best[1]],
    winner: s.winner,
    matches: s.matches,
  };
}

export function cloneState(s: ArcheryState): ArcheryState {
  return { ...snapshot(s), rng: s.rng };
}

function land(s: ArcheryState, hit: Hit | null, lost: "time" | "short" | undefined, ev: ArcheryEvent[]): void {
  const { points, bullseye } = scoreHit(hit);
  const shot: Shot = { seat: s.turn, stage: s.stage, distance: s.distance, hit, points, bullseye };
  if (lost) shot.lost = lost;
  s.shots.push(shot);
  if (s.format === "unlimited" && s.shots.length > 20) s.shots.shift();
  // sudden death only decides the winner; the score stays the stages' total
  if (s.stage !== SUDDEN_DEATH) s.totals[s.turn] += points;
  s.best[s.turn] = Math.max(s.best[s.turn], points);
  s.phase = "result";
  s.phaseTick = 0;
  ev.push({ type: "shot", seat: s.turn, points, bullseye, stage: s.stage, ...(lost ? { lost } : {}) });
}

function finishMatch(s: ArcheryState, winner: Seat, ev: ArcheryEvent[]): void {
  s.winner = winner;
  s.phase = "over";
  s.phaseTick = 0;
  s.matches++;
  ev.push({ type: "match", winner, score: [s.totals[0], s.totals[1]] });
}

/** After a result: the other seat's turn, the next stage, sudden death or the end. */
function advance(s: ArcheryState, ev: ArcheryEvent[]): void {
  s.turnInStage++;
  if (s.turnInStage < 2) {
    s.turn = other(s.turn);
    startTurn(s);
    return;
  }
  if (s.format === "unlimited") {
    s.turn = other(s.turn);
    startStage(s, 0, ev);
    return;
  }
  if (s.stage < STAGES.length - 1) return startStage(s, s.stage + 1, ev);
  if (s.stage === STAGES.length - 1) {
    if (s.totals[0] !== s.totals[1]) return finishMatch(s, s.totals[0] > s.totals[1] ? 0 : 1, ev);
    return startStage(s, SUDDEN_DEATH, ev);
  }
  // sudden death: the nearer arrow of this pair wins; an exact tie shoots again
  const [a, b] = s.shots.slice(-2);
  const ca = closeness(a);
  const cb = closeness(b);
  if (ca === cb) return startStage(s, SUDDEN_DEATH, ev);
  const nearer = ca < cb ? a.seat : b.seat;
  finishMatch(s, nearer, ev);
}

export function step(s: ArcheryState, inputs: readonly ArcheryInput[]): ArcheryEvent[] {
  const ev: ArcheryEvent[] = [];
  s.tick++;
  s.phaseTick++;
  for (const input of inputs) {
    if (s.phase !== "aim" || input.seat !== s.turn) continue;
    const aim = clampAim(input);
    s.aim = aim;
    if (input.t === "release" && aim.draw >= MIN_DRAW) {
      const { pos, vel } = launch(aim);
      s.arrow = { pos, vel, ticks: 0 };
      s.phase = "flight";
      s.phaseTick = 0;
      break;
    }
  }
  if (s.phase === "aim" && s.phaseTick >= SHOT_CLOCK_TICKS) {
    land(s, null, "time", ev);
  } else if (s.phase === "flight" && s.arrow) {
    s.arrow.ticks++;
    const r = flyStep(s.arrow, s.distance, s.wind);
    if (r.kind === "hit") land(s, r.hit, undefined, ev);
    else if (r.kind === "short" || s.arrow.ticks >= MAX_FLIGHT_TICKS) land(s, null, "short", ev);
  } else if (s.phase === "result" && s.phaseTick >= RESULT_TICKS) {
    advance(s, ev);
  } else if (s.phase === "over" && s.endless && s.phaseTick >= OVER_TICKS) {
    freshMatch(s, ev);
  }
  return ev;
}
