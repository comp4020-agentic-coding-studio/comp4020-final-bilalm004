export const DT = 1 / 60;

export const COURT = {
  halfW: 4.1,
  halfL: 11,
  netH: 0.9,
  gravity: 9.8,
  restitution: 0.72,
  hitWindow: 1.6,
  endMargin: 3,
  winScore: 5,
  serveDelayTicks: 75,
} as const;

export const PLAYER = {
  // metres per second; a full court width takes about 1.6 s
  speed: 5,
  // lateral distance from the player to the ball at which a swing still connects
  reach: 1.4,
  // highest ball a swing can reach
  maxContactY: 2.6,
  // how far outside the sideline a player may stand
  sideRoom: 1.5,
} as const;

export type Seat = 0 | 1;
export type Level = 0 | 1 | 2;
export type SwingKind = "forehand" | "backhand";
export type Hand = "right" | "left";

export const LEVEL_NAMES = ["light", "medium", "hard"] as const;

interface Stroke {
  // forward speed (m/s)
  speed: number;
  // upward speed at the ideal contact height (m/s)
  loft: number;
  // extra upward speed per metre of contact height above ideal: high balls fly
  // long, low balls dip into the net, and the harder the swing the more so
  heightGain: number;
}

const IDEAL_CONTACT_Y = 1;

// Indexed by level. Backhand hard is slower than forehand hard but steadier
// (less sensitive to contact height).
const STROKES: Record<SwingKind, readonly [Stroke, Stroke, Stroke]> = {
  forehand: [
    { speed: 11, loft: 7, heightGain: 0.3 },
    { speed: 14, loft: 5.2, heightGain: 0.9 },
    { speed: 18, loft: 3.5, heightGain: 2.8 },
  ],
  backhand: [
    { speed: 11, loft: 7, heightGain: 0.3 },
    { speed: 14, loft: 5.2, heightGain: 0.9 },
    { speed: 16.5, loft: 4, heightGain: 1.8 },
  ],
};

// Swinging a forehand at a ball on the backhand side (or the reverse).
const MISMATCH = { speed: 0.8, loft: 1.15 } as const;

// Lateral speed per unit of forward speed at full aim, so aim lands in a
// similar place whatever the level.
const AIM_SPREAD = 0.2;

export interface Ball {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface Player {
  x: number;
  targetX: number;
}

export interface TennisState {
  tick: number;
  phase: "serve" | "rally" | "over";
  phaseTick: number;
  server: Seat;
  ball: Ball;
  players: [Player, Player];
  lastHitter: Seat | null;
  bounces: number;
  score: [number, number];
  // first to this many points wins; null plays forever (practice)
  winScore: number | null;
  winner: Seat | null;
  rng: number;
}

export type TennisSnapshot = Omit<TennisState, "rng">;

export interface Swing {
  t: "swing";
  seat: Seat;
  dirX: number;
  kind: SwingKind;
  level: Level;
  hand?: Hand;
}

export interface Move {
  t: "move";
  seat: Seat;
  x: number;
}

export type TennisInput = Swing | Move;

export const seatZ = (seat: Seat): number => (seat === 0 ? COURT.halfL : -COURT.halfL);
export const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const maxPlayerX = COURT.halfW + PLAYER.sideRoom;

function random(s: TennisState): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** The swing that suits a ball at `ballX` for a player at `playerX`. */
export function naturalKind(seat: Seat, playerX: number, ballX: number, hand: Hand = "right"): SwingKind {
  // seat 0 faces -z, so its right is +x; seat 1 faces +z, its right is -x
  const right = (ballX - playerX) * (seat === 0 ? 1 : -1);
  return (right >= 0) === (hand === "right") ? "forehand" : "backhand";
}

function resetServe(s: TennisState): void {
  s.phase = "serve";
  s.phaseTick = 0;
  s.lastHitter = null;
  s.bounces = 0;
  s.ball = { x: 0, y: 1, z: seatZ(s.server), vx: 0, vy: 0, vz: 0 };
}

export function createState(seed: number, winScore: number | null = COURT.winScore): TennisState {
  const s: TennisState = {
    tick: 0,
    phase: "serve",
    phaseTick: 0,
    server: 0,
    ball: { x: 0, y: 1, z: seatZ(0), vx: 0, vy: 0, vz: 0 },
    players: [
      { x: 0, targetX: 0 },
      { x: 0, targetX: 0 },
    ],
    lastHitter: null,
    bounces: 0,
    score: [0, 0],
    winScore,
    winner: null,
    rng: seed >>> 0,
  };
  resetServe(s);
  return s;
}

export function snapshot(s: TennisState): TennisSnapshot {
  return {
    tick: s.tick,
    phase: s.phase,
    phaseTick: s.phaseTick,
    server: s.server,
    ball: { ...s.ball },
    players: [{ ...s.players[0] }, { ...s.players[1] }],
    lastHitter: s.lastHitter,
    bounces: s.bounces,
    score: [s.score[0], s.score[1]],
    winScore: s.winScore,
    winner: s.winner,
  };
}

function awardPoint(s: TennisState, winner: Seat): void {
  s.score[winner]++;
  if (s.winScore !== null && s.score[winner] >= s.winScore) {
    s.phase = "over";
    s.winner = winner;
    return;
  }
  s.server = other(s.server);
  resetServe(s);
}

function launchServe(s: TennisState): void {
  const dir = s.server === 0 ? -1 : 1;
  s.ball = {
    x: s.ball.x,
    y: 1.2,
    z: seatZ(s.server),
    vx: (random(s) - 0.5) * 2,
    vy: 4.5,
    vz: dir * 13,
  };
  s.phase = "rally";
  s.lastHitter = s.server;
  s.bounces = 0;
}

/** Sends the ball back from wherever it is now. Shared by real hits and predictLanding. */
function launch(b: Ball, seat: Seat, playerX: number, dirX: number, kind: SwingKind, level: Level, hand: Hand): void {
  const stroke = STROKES[kind][level];
  const matched = naturalKind(seat, playerX, b.x, hand) === kind;
  const speed = stroke.speed * (matched ? 1 : MISMATCH.speed);
  const loft = (stroke.loft + (b.y - IDEAL_CONTACT_Y) * stroke.heightGain) * (matched ? 1 : MISMATCH.loft);
  b.vz = (seat === 0 ? -1 : 1) * speed;
  b.vx = clamp(dirX, -1, 1) * speed * AIM_SPREAD;
  b.vy = loft;
}

function canHit(s: TennisState, seat: Seat): boolean {
  if (s.phase !== "rally" || s.lastHitter === seat) return false;
  const b = s.ball;
  const heading = seat === 0 ? b.vz > 0 : b.vz < 0;
  if (!heading || Math.abs(b.z - seatZ(seat)) > COURT.hitWindow) return false;
  return Math.abs(b.x - s.players[seat].x) <= PLAYER.reach && b.y <= PLAYER.maxContactY;
}

function tryHit(s: TennisState, swing: Swing): void {
  if (!canHit(s, swing.seat)) return;
  launch(s.ball, swing.seat, s.players[swing.seat].x, swing.dirX, swing.kind, swing.level, swing.hand ?? "right");
  s.lastHitter = swing.seat;
  s.bounces = 0;
}

function movePlayers(s: TennisState): void {
  const maxStep = PLAYER.speed * DT;
  for (const p of s.players) {
    const d = p.targetX - p.x;
    p.x = Math.abs(d) <= maxStep ? p.targetX : p.x + Math.sign(d) * maxStep;
  }
}

/** One tick of ball flight. Reports a net cord or a bounce (already reflected). */
function moveBall(b: Ball): "net" | "bounce" | null {
  const prevZ = b.z;
  b.vy -= COURT.gravity * DT;
  b.x += b.vx * DT;
  b.y += b.vy * DT;
  b.z += b.vz * DT;
  if (prevZ > 0 !== b.z > 0 && b.y < COURT.netH) return "net";
  if (b.y < 0) {
    b.y = 0;
    b.vy = -b.vy * COURT.restitution;
    return "bounce";
  }
  return null;
}

function onBounce(s: TennisState): void {
  const b = s.ball;
  const hitter = s.lastHitter as Seat;
  const inBounds = Math.abs(b.x) <= COURT.halfW && Math.abs(b.z) <= COURT.halfL;
  if (!inBounds) return awardPoint(s, other(hitter));
  const hitterSide = hitter === 0 ? 1 : -1;
  if (Math.sign(b.z) === hitterSide) return awardPoint(s, other(hitter));
  s.bounces++;
  if (s.bounces >= 2) awardPoint(s, hitter);
}

export function step(s: TennisState, inputs: readonly TennisInput[]): void {
  s.tick++;
  s.phaseTick++;
  if (s.phase === "over") return;

  for (const input of inputs) {
    if (input.t === "move") s.players[input.seat].targetX = clamp(input.x, -maxPlayerX, maxPlayerX);
  }
  movePlayers(s);

  if (s.phase === "serve") {
    // the ball waits in front of the server, within the middle of the court
    s.ball.x = clamp(s.players[s.server].x, -COURT.halfW * 0.6, COURT.halfW * 0.6);
    if (s.phaseTick >= COURT.serveDelayTicks) launchServe(s);
    return;
  }

  for (const input of inputs) if (input.t === "swing") tryHit(s, input);

  const event = moveBall(s.ball);
  if (event === "net") return awardPoint(s, other(s.lastHitter as Seat));
  if (event === "bounce") {
    onBounce(s);
    if (s.phase !== "rally") return;
  }
  if (Math.abs(s.ball.z) > COURT.halfL + COURT.endMargin) {
    const hitter = s.lastHitter as Seat;
    awardPoint(s, s.bounces >= 1 ? hitter : other(hitter));
  }
}

export interface Contact {
  ball: Ball;
  ticks: number;
}

/**
 * Where the ball will be when it reaches `seat`'s baseline (the middle of the
 * hit window), if the rally gets that far. Pure: `s` is not modified.
 */
export function predictContact(s: TennisState, seat: Seat, maxTicks = 600): Contact | null {
  if (s.phase !== "rally" || s.lastHitter === seat) return null;
  const b = { ...s.ball };
  const heading = seat === 0 ? b.vz > 0 : b.vz < 0;
  if (!heading) return null;
  let bounces = s.bounces;
  const baseline = seatZ(seat);
  for (let ticks = 0; ticks <= maxTicks; ticks++) {
    const past = (b.z - baseline) * Math.sign(baseline);
    if (past >= 0) return past <= COURT.hitWindow ? { ball: b, ticks } : null;
    const event = moveBall(b);
    if (event === "net") return null;
    if (event === "bounce" && ++bounces >= 2) return null;
  }
  return null;
}

export interface Landing {
  x: number;
  z: number;
  // false when it would hit the net, land out, or land on the hitter's side
  in: boolean;
  net: boolean;
  // it clears the net and first touches down on the opponent's half (in or out)
  farSide: boolean;
  // true: from the ball actually coming at you; false: from aim alone
  predicted: boolean;
}

/**
 * Where `seat`'s next shot would first touch down with this aim and level,
 * using the swing that suits the ball's side. When the ball is coming at
 * them, it is hit at the predicted contact point and matches a real hit there
 * exactly. Otherwise (serve, their own shot still travelling, a ball that won't
 * reach them) it is hit from where they stand at a comfortable height, so aim
 * always has somewhere to show. A guide for the reticle; the server decides
 * the real hit. Pure: `s` is not modified.
 */
export function predictLanding(s: TennisState, seat: Seat, aim: number, level: Level, hand: Hand = "right"): Landing {
  const playerX = s.players[seat].x;
  const contact = predictContact(s, seat);
  const b = contact ? contact.ball : { x: playerX, y: IDEAL_CONTACT_Y, z: seatZ(seat), vx: 0, vy: 0, vz: 0 };
  launch(b, seat, playerX, aim, naturalKind(seat, playerX, b.x, hand), level, hand);
  const predicted = contact !== null;
  for (let i = 0; i < 600; i++) {
    const event = moveBall(b);
    if (event === "net") return { x: b.x, z: 0, in: false, net: true, farSide: false, predicted };
    if (event === "bounce") {
      const inBounds = Math.abs(b.x) <= COURT.halfW && Math.abs(b.z) <= COURT.halfL;
      const farSide = Math.sign(b.z) === (seat === 0 ? -1 : 1);
      return { x: b.x, z: b.z, in: inBounds && farSide, net: false, farSide, predicted };
    }
  }
  // unreachable: a launched ball always comes down within 10 s
  return { x: b.x, z: b.z, in: false, net: false, farSide: false, predicted };
}
