import { createScore, fault, other as otherSide, pointWon } from "./scoring.ts";
import type { MatchFormat, ScoreState } from "./scoring.ts";

export type { MatchFormat, ScoreState } from "./scoring.ts";

export const DT = 1 / 60;

export const COURT = {
  halfW: 4.1,
  halfL: 11,
  netH: 0.9,
  gravity: 9.8,
  restitution: 0.72,
  hitWindow: 1.6,
  endMargin: 3,
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
  // forward speed (m/s); the arc is lifted (and slowed) only if this is too
  // flat to clear the net
  speed: number;
  // where the ball first lands: metres past the net on the opponent's half
  depth: number;
}

// Height a launched ball is at when the player stands still to hit it: the
// fallback contact for predictLanding when no ball is coming.
const IDEAL_CONTACT_Y = 1;

// An unreturned ball's point is scored this many ticks after it is decided,
// matching the most a swing can be rewound (150 ms, ADR 001), so a lagged
// swing that was on time is never refused because the point beat it.
export const CONFIRM_TICKS = 9;

// Indexed by level. Strength sets depth and pace; contact height never
// changes where the ball lands (launch solves the upward speed). Backhand hard
// is a little slower than forehand hard, same depth.
export const STROKES: Record<SwingKind, readonly [Stroke, Stroke, Stroke]> = {
  forehand: [
    { speed: 11, depth: 4 },
    { speed: 14, depth: 6 },
    { speed: 18, depth: 8 },
  ],
  backhand: [
    { speed: 11, depth: 4 },
    { speed: 14, depth: 6 },
    { speed: 16.5, depth: 8 },
  ],
};

// Extra depth (m) at full lift in camera follow mode: a high hand lands deeper.
const LIFT_DEPTH = 1;
// Landing depth is kept within this, past the net, whatever the lift.
const MIN_DEPTH = 2.5;
const MAX_DEPTH = COURT.halfL - 1.5;
// Height the ball must have when it passes over the net.
export const NET_CLEARANCE = COURT.netH + 0.3;

// A ball this close to the player's middle can be taken on either side, so a
// keyboard swing judged from a slightly older ball, or a camera swing at a ball
// straight at you, isn't a wrong-side miss.
export const EITHER_SIDE = 0.3;

// Lateral speed per unit of forward speed at full aim, by level: sideways
// travel at full aim is this share of the flight's length. Hard spreads more,
// so a hard shot timed at the edge of the window goes wide; that is what
// keeps hard from being the only shot worth playing.
const AIM_SPREAD = [0.15, 0.2, 0.26] as const;

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

/**
 * How a seat moves. "auto": the server walks it to the ball (autoTargetX),
 * so the player only swings. "tilt": only the player's own move messages
 * (shoulder tilt, keys, buttons) move it. A move message in auto still moves
 * you (`manual`), until the next ball is struck toward you.
 */
export type MoveMode = "auto" | "tilt";
export const MOVE_MODES: readonly MoveMode[] = ["auto", "tilt"];

export interface Movement {
  mode: MoveMode;
  // a move message took over from auto; cleared when a ball is next struck toward this seat
  manual: boolean;
}

// Auto-move stops this far short of where it will meet the ball, on the side
// the ball is heading to, so the ball is clearly on the forehand or backhand
// side (more than EITHER_SIDE) yet in reach across the hit window. Auto
// keeps following the ball until the middle of the window, so the drift that
// matters is over its late half. Measured with the 0.32 s window (task 12,
// 60 seeds of bot play): an auto-moved receiver is in reach with the side
// auto set up at every tick of all three thirds, as with 0.22 s. It is also
// about where the racket meets the ball in the stroke animation.
export const AUTO_OFFSET = 0.6;
// Auto-move walks at this share of PLAYER.speed (manual, tilt and keys keep
// the full speed). At full speed it would reach nearly every ball and
// strength would stop mattering: a full-aim wide shot needs a run of about
// AIM_SPREAD x ball speed, ~1.7 m/s light, 2.8 medium, 4.7 hard. Measured
// from the far sideline (spec/auto-move.test.ts, devlog 2026-10-15): at 0.7
// (3.5 m/s) full-aim shots that land in are reached 100% light, 50% medium,
// 0% hard; straight shots 100% at every level. 0.6 gave 80/25/0 and a
// bot-vs-bot mean rally of 3.76 (0.7: 3.91, the band before auto was 3.8-3.9).
export const AUTO_SPEED = 0.7;
// Sideways speed (m/s) under which a ball counts as coming straight: auto then
// takes it on the side of the court it is on.
const AUTO_STRAIGHT_VX = 0.5;

export interface TennisState {
  tick: number;
  phase: "serve" | "rally" | "over";
  phaseTick: number;
  server: Seat;
  ball: Ball;
  players: [Player, Player];
  movement: [Movement, Movement];
  lastHitter: Seat | null;
  bounces: number;
  // shots in the current rally, the serve included
  shots: number;
  // an unreturned ball's point, decided but not yet scored: it is scored once
  // `atTick` comes, so a lagged swing judged earlier by rewind can still play
  // it. `dead`: decided by a touchdown that ends the rally (landing out, or a
  // second bounce), so no swing can play it now; only a swing rewound to
  // before that touchdown still can (task 12).
  pending: { winner: Seat; reason: PointReason; atTick: number; dead: boolean } | null;
  // where the ball last touched down, including a bounce that ends the point
  lastBounce: { x: number; z: number; in: boolean; tick: number } | null;
  // real tennis scoring (scoring.ts); `server` above always equals score.server
  score: ScoreState;
  // practice: a finished match starts a fresh one instead of ending the game
  endless: boolean;
  // serves that have ended, by a point or a fault: rewind never crosses one
  rally: number;
  // the latest point or fault, for the score bar's announcement; seat is the
  // point's winner, or the server for a fault
  lastCall: { call: "point" | "fault"; seat: Seat; reason: PointReason; tick: number } | null;
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
  // camera "follow" mode: hand height at contact, -1 low (flatter) .. 1 high (more loft)
  lift?: number;
  // aim from timing instead of dirX: early pulls cross-court, late pushes
  // down the line, judged from the server's own ball position
  timingAim?: boolean;
}

export interface Move {
  t: "move";
  seat: Seat;
  x: number;
}

export interface ModeInput {
  t: "mode";
  seat: Seat;
  mode: MoveMode;
}

export type TennisInput = Swing | Move | ModeInput;

// "double fault" ends a point; the others end a rally (or, on a serve the
// receiver never touched, make a fault)
export type PointReason = "out" | "net" | "own side" | "unreturned" | "double fault";

/** What a step did, for logs and replies; never needed to replay the game. */
export type TennisEvent =
  | { type: "swing"; seat: Seat; outcome: "hit" | Miss }
  | { type: "point"; winner: Seat; shots: number; reason: PointReason }
  | { type: "fault"; server: Seat; reason: PointReason };

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
  s.server = s.score.server;
  s.phase = "serve";
  s.phaseTick = 0;
  s.lastHitter = null;
  s.bounces = 0;
  s.shots = 0;
  s.pending = null;
  s.ball = { x: 0, y: 1, z: seatZ(s.server), vx: 0, vy: 0, vz: 0 };
}

export interface StateOptions {
  format?: MatchFormat;
  endless?: boolean;
  // both seats start in this; a bare sim (tests) defaults to "tilt" so players
  // stay where a test puts them, a real game (index.ts) to "auto"
  moveMode?: MoveMode;
}

export function createState(seed: number, options: StateOptions = {}): TennisState {
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
    movement: [
      { mode: options.moveMode ?? "tilt", manual: false },
      { mode: options.moveMode ?? "tilt", manual: false },
    ],
    lastHitter: null,
    bounces: 0,
    shots: 0,
    pending: null,
    lastBounce: null,
    score: createScore(options.format ?? "oneSet", 0),
    endless: options.endless ?? false,
    rally: 0,
    lastCall: null,
    winner: null,
    rng: seed >>> 0,
  };
  resetServe(s);
  return s;
}

function copyScore(sc: ScoreState): ScoreState {
  return {
    ...sc,
    points: [sc.points[0], sc.points[1]],
    games: [sc.games[0], sc.games[1]],
    sets: [sc.sets[0], sc.sets[1]],
    setScores: sc.setScores.map(([a, b]) => [a, b]),
  };
}

export function snapshot(s: TennisState): TennisSnapshot {
  return {
    tick: s.tick,
    phase: s.phase,
    phaseTick: s.phaseTick,
    server: s.server,
    ball: { ...s.ball },
    players: [{ ...s.players[0] }, { ...s.players[1] }],
    movement: [{ ...s.movement[0] }, { ...s.movement[1] }],
    lastHitter: s.lastHitter,
    bounces: s.bounces,
    shots: s.shots,
    pending: s.pending ? { ...s.pending } : null,
    lastBounce: s.lastBounce ? { ...s.lastBounce } : null,
    score: copyScore(s.score),
    endless: s.endless,
    rally: s.rally,
    lastCall: s.lastCall ? { ...s.lastCall } : null,
    winner: s.winner,
  };
}

/** A full copy, rng included, so stepping it is exactly stepping the original. */
export function cloneState(s: TennisState): TennisState {
  return { ...snapshot(s), rng: s.rng };
}

/**
 * The serve or rally is over and `winner` takes it. A serve the receiver never
 * touched that the server loses (net, out, own side) is a fault instead: the
 * first earns a second serve, the second is a double fault and loses the
 * point. No lets: a serve that clips the net and lands in plays on, as it
 * never ends here. The score module decides games, sets, who serves and the
 * match; the sim never mutates the score, only replaces it.
 */
function awardPoint(s: TennisState, winner: Seat, reason: PointReason, ev: TennisEvent[]): void {
  const serving = s.score.server;
  s.rally++;
  if (s.shots === 1 && winner !== serving) {
    s.score = fault(s.score);
    if (s.score.faults === 1) {
      ev.push({ type: "fault", server: serving, reason });
      s.lastCall = { call: "fault", seat: serving, reason, tick: s.tick };
      resetServe(s);
      return;
    }
    reason = "double fault";
  } else {
    s.score = pointWon(s.score, winner);
  }
  ev.push({ type: "point", winner, shots: s.shots, reason });
  s.lastCall = { call: "point", seat: winner, reason, tick: s.tick };
  if (s.score.winner !== null) {
    if (!s.endless) {
      s.phase = "over";
      s.winner = s.score.winner;
      return;
    }
    // Practice plays on, but the won score stays on the board through the pause
    // before the next serve (the serve countdown); the fresh match starts when
    // that serve is about to launch (see the serve phase in step). Resetting it
    // here sent the board straight from the final score to 0-0 (user's playtest).
  }
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
  s.shots = 1;
  s.movement[other(s.server)].manual = false;
}

/**
 * Sends the ball back from wherever it is now, so it first lands `depth` past
 * the net whatever the contact height. Shared by real hits, predictLanding and
 * so the bot. The flight time T comes from the stroke's speed; the upward
 * speed is solved from T. If that arc would pass the net lower than
 * NET_CLEARANCE, T is lengthened (the ball slowed and lofted) just enough.
 * Exact for the tick integration in moveBall, not only the continuous arc.
 * Exported for training's ball machine (machine.ts), which feeds with it.
 */
export function launch(b: Ball, seat: Seat, dirX: number, kind: SwingKind, level: Level, lift = 0): void {
  const stroke = STROKES[kind][level];
  const depth = clamp(stroke.depth + clamp(lift, -1, 1) * LIFT_DEPTH, MIN_DEPTH, MAX_DEPTH);
  // distance to the net and to the landing spot, along the court
  const toNet = Math.max(0, b.z * Math.sign(seatZ(seat)));
  const dist = toNet + depth;
  let t = dist / stroke.speed;
  // height over the net with flight time t is y(1-f) + g f(1-f) t^2 / 2,
  // f the share of the flight spent reaching the net (same with tick steps)
  const f = toNet / dist;
  if (f > 0 && f < 1) {
    const minT2 = (2 * (NET_CLEARANCE - b.y * (1 - f))) / (COURT.gravity * f * (1 - f));
    if (minT2 > t * t) t = Math.sqrt(minT2);
  }
  // land on the tick the flight time says: y(n) = y + vy n dt - g dt^2 n(n+1)/2
  const n = t / DT;
  const vy = (COURT.gravity * DT * DT * n * (n + 1) * 0.5 - b.y) / (n * DT);
  const speed = dist / t;
  b.vz = (seat === 0 ? -1 : 1) * speed;
  b.vx = clamp(dirX, -1, 1) * speed * AIM_SPREAD[level];
  b.vy = vy;
}

// A swing connects within this long of the ball reaching your baseline, either
// side. Camera swings land within about 0.1 s at best (frame interval plus
// pose detection), so a fixed 1.6 m (0.09-0.15 s at rally speeds) was mostly
// luck; time-based, the window is the same for fast and slow balls.
// 0.32 s (task 12, was 0.22): early, on time and late are about 0.21 s each.
export const HIT_WINDOW_S = 0.32;

/** How far from the baseline (along the court) the ball can be and still be hit. */
export function hitWindowDistance(b: Ball): number {
  return Math.max(COURT.hitWindow, Math.abs(b.vz) * HIT_WINDOW_S);
}

// "out" / "two bounces": the ball has already landed out, or bounced twice, so
// it is dead (task 12). A ball still in the air that is going out can be hit:
// that is the player's choice.
export type Miss = "no ball" | "out" | "two bounces" | "early" | "late" | "reach" | "high" | "wrong side";

/**
 * Whether `kind` suits a ball at `ballX`: the natural swing, or either one
 * when the ball is within EITHER_SIDE of the player's middle.
 */
export function kindFits(seat: Seat, playerX: number, ballX: number, kind: SwingKind, hand: Hand = "right"): boolean {
  return Math.abs(ballX - playerX) <= EITHER_SIDE || naturalKind(seat, playerX, ballX, hand) === kind;
}

/**
 * Why a swing by `seat` right now would miss, or null if it would connect.
 * With `kind`, a forehand at a ball on the backhand side (or the reverse) is
 * a "wrong side" miss; without it, the side isn't checked.
 */
export function missReason(s: TennisState, seat: Seat, kind?: SwingKind, hand: Hand = "right"): Miss | null {
  if (s.phase !== "rally" || s.lastHitter === seat) return "no ball";
  const b = s.ball;
  const heading = seat === 0 ? b.vz > 0 : b.vz < 0;
  if (!heading) return "no ball";
  if (s.pending?.dead) return s.pending.reason === "out" ? "out" : "two bounces";
  // positive once the ball is past the baseline
  const past = (b.z - seatZ(seat)) * Math.sign(seatZ(seat));
  const window = hitWindowDistance(b);
  if (past < -window) return "early";
  if (past > window) return "late";
  if (Math.abs(b.x - s.players[seat].x) > PLAYER.reach) return "reach";
  if (b.y > PLAYER.maxContactY) return "high";
  if (kind && !kindFits(seat, s.players[seat].x, b.x, kind, hand)) return "wrong side";
  return null;
}

/**
 * Aim from timing: how early or late the ball is met, -1 (earliest in the
 * window) to 1 (latest), turned into a direction. Early pulls the ball across
 * the body (a right-hander's forehand goes to their left), late pushes it the
 * other way, on time goes straight. Returns world dirX.
 */
export function timingAim(b: Ball, seat: Seat, kind: SwingKind, hand: Hand): number {
  const past = (b.z - seatZ(seat)) * Math.sign(seatZ(seat));
  const u = clamp(past / hitWindowDistance(b), -1, 1);
  // in the player's own frame, positive is to their right
  const toRight = u * (kind === "forehand" ? 1 : -1) * (hand === "right" ? 1 : -1);
  return toRight * (seat === 0 ? 1 : -1);
}

function tryHit(s: TennisState, swing: Swing): Miss | null {
  const hand = swing.hand ?? "right";
  const miss = missReason(s, swing.seat, swing.kind, hand);
  if (miss) return miss;
  const dirX = swing.timingAim ? timingAim(s.ball, swing.seat, swing.kind, hand) : swing.dirX;
  launch(s.ball, swing.seat, dirX, swing.kind, swing.level, swing.lift);
  s.lastHitter = swing.seat;
  s.bounces = 0;
  s.shots++;
  s.pending = null;
  s.movement[other(swing.seat)].manual = false;
  return null;
}

/** Top speed (m/s) for `seat` now: slower while auto-move is walking it. */
export function seatSpeed(s: TennisState, seat: Seat): number {
  const m = s.movement[seat];
  return m.mode === "auto" && !m.manual ? PLAYER.speed * AUTO_SPEED : PLAYER.speed;
}

function movePlayers(s: TennisState): void {
  for (const seat of [0, 1] as const) {
    const p = s.players[seat];
    const maxStep = seatSpeed(s, seat) * DT;
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

function onBounce(s: TennisState, ev: TennisEvent[]): void {
  const b = s.ball;
  const hitter = s.lastHitter as Seat;
  const inBounds = Math.abs(b.x) <= COURT.halfW && Math.abs(b.z) <= COURT.halfL;
  const hitterSide = hitter === 0 ? 1 : -1;
  const good = inBounds && (s.bounces > 0 || Math.sign(b.z) !== hitterSide);
  s.lastBounce = { x: b.x, z: b.z, in: good, tick: s.tick };
  // a shot that never crossed is decided by the shot itself
  if (Math.sign(b.z) === hitterSide) {
    if (!inBounds) return awardPoint(s, other(hitter), "out", ev);
    return awardPoint(s, other(hitter), "own side", ev);
  }
  // out on the receiver's side: they could have played it before it landed
  if (!inBounds) {
    s.pending = { winner: other(hitter), reason: "out", atTick: s.tick + CONFIRM_TICKS, dead: true };
    return;
  }
  s.bounces++;
  if (s.bounces >= 2 && !s.pending) s.pending = { winner: hitter, reason: "unreturned", atTick: s.tick + CONFIRM_TICKS, dead: true };
}

export function step(s: TennisState, inputs: readonly TennisInput[]): TennisEvent[] {
  const ev: TennisEvent[] = [];
  s.tick++;
  s.phaseTick++;
  if (s.phase !== "rally") {
    for (const input of inputs) if (input.t === "swing") ev.push({ type: "swing", seat: input.seat, outcome: "no ball" });
  }
  if (s.phase === "over") return ev;

  for (const input of inputs) {
    if (input.t === "mode") s.movement[input.seat] = { mode: input.mode, manual: false };
  }
  for (const input of inputs) {
    if (input.t !== "move") continue;
    s.players[input.seat].targetX = clamp(input.x, -maxPlayerX, maxPlayerX);
    if (s.movement[input.seat].mode === "auto") s.movement[input.seat].manual = true;
  }
  for (const seat of [0, 1] as const) {
    const m = s.movement[seat];
    if (m.mode === "auto" && !m.manual) s.players[seat].targetX = autoTargetX(s, seat);
  }
  movePlayers(s);

  if (s.phase === "serve") {
    // the ball waits in front of the server, within the middle of the court
    s.ball.x = clamp(s.players[s.server].x, -COURT.halfW * 0.6, COURT.halfW * 0.6);
    if (s.phaseTick >= COURT.serveDelayTicks) {
      // a practice match was won: the board has shown it through the pause, now a fresh one, served by whoever serves next
      if (s.endless && s.score.winner !== null) {
        s.score = createScore(s.score.format, otherSide(s.score.gameServer));
        s.server = s.score.server;
        s.ball.z = seatZ(s.server);
      }
      launchServe(s);
    }
    return ev;
  }

  for (const input of inputs) {
    if (input.t === "swing") ev.push({ type: "swing", seat: input.seat, outcome: tryHit(s, input) ?? "hit" });
  }

  const event = moveBall(s.ball);
  if (event === "net" && !s.pending) {
    awardPoint(s, other(s.lastHitter as Seat), "net", ev);
    return ev;
  }
  // once a point is decided the ball just runs on; nothing else can score
  if (event === "bounce" && !s.pending) {
    onBounce(s, ev);
    if (s.phase !== "rally") return ev;
  }
  // past the receiver's end and their hit window, still in the air: they could
  // have played it, so it waits for rewind. Only the receiver's end: a ball
  // just hit from deep behind the hitter's own baseline is still on its way.
  // Not before the window closes: deciding it while the ball is still
  // hittable would score it before a lagged on-time swing arrives (task 12:
  // the 0.32 s window reaches past endMargin at rally speeds).
  const hitter = s.lastHitter as Seat;
  const past = s.ball.z * Math.sign(seatZ(other(hitter))) - COURT.halfL;
  const pastEnd = past > Math.max(COURT.endMargin, hitWindowDistance(s.ball));
  if (pastEnd && !s.pending) {
    s.pending = s.bounces >= 1
      ? { winner: hitter, reason: "unreturned", atTick: s.tick + CONFIRM_TICKS, dead: false }
      : { winner: other(hitter), reason: "out", atTick: s.tick + CONFIRM_TICKS, dead: false };
  }
  if (s.pending && s.tick >= s.pending.atTick) awardPoint(s, s.pending.winner, s.pending.reason, ev);
  return ev;
}

/**
 * Whether the ball in flight will first touch down in bounds on the far side
 * from its hitter: run on with the same moveBall the sim uses. False if it
 * goes into the net or lands out (or on the hitter's own side). A ball that
 * has already bounced in has nothing left to decide, so it is in. Pure.
 */
export function willLandIn(s: TennisState): boolean {
  if (s.phase !== "rally" || s.lastHitter === null) return false;
  if (s.pending) return false;
  if (s.bounces > 0) return true;
  const b = { ...s.ball };
  const farSide = s.lastHitter === 0 ? -1 : 1;
  for (let i = 0; i < 600; i++) {
    const event = moveBall(b);
    if (event === "net") return false;
    if (event === "bounce") return Math.abs(b.x) <= COURT.halfW && Math.abs(b.z) <= COURT.halfL && Math.sign(b.z) === farSide;
  }
  return false;
}

export interface Contact {
  ball: Ball;
  ticks: number;
}

/**
 * Where the ball will be when it reaches `seat`'s baseline (the middle of the
 * hit window), if the rally gets that far. A ball that will land out before
 * the baseline is dead from then on (task 12), so its contact is the last tick
 * it is still in the air, if that is inside the window (it can be volleyed),
 * and none otherwise; likewise none for the net or a second bounce. Pure: `s`
 * is not modified.
 */
export function predictContact(s: TennisState, seat: Seat, maxTicks = 600): Contact | null {
  if (s.phase !== "rally" || s.lastHitter === seat) return null;
  const b = { ...s.ball };
  const heading = seat === 0 ? b.vz > 0 : b.vz < 0;
  if (!heading || s.pending?.dead) return null;
  let bounces = s.bounces;
  const baseline = seatZ(seat);
  for (let ticks = 0; ticks <= maxTicks; ticks++) {
    const past = (b.z - baseline) * Math.sign(baseline);
    if (past >= 0) return past <= hitWindowDistance(b) ? { ball: b, ticks } : null;
    const before = { ...b };
    const event = moveBall(b);
    if (event === "net") return null;
    if (event === "bounce") {
      const inBounds = Math.abs(b.x) <= COURT.halfW && Math.abs(b.z) <= COURT.halfL;
      if (bounces === 0 && !inBounds) return past >= -hitWindowDistance(before) ? { ball: before, ticks } : null;
      if (++bounces >= 2) return null;
    }
  }
  return null;
}

/**
 * Where auto-move sends `seat`: AUTO_OFFSET short of where it will meet the
 * coming ball, on the side the ball is heading to (its sideways travel, or for
 * a straight ball the side of the court it is on; dead centre is the
 * forehand side of a right-hander). The sim still applies the speed cap, so a
 * wide ball can beat you. Once the ball is past the middle of the window it
 * keeps the target, so a late swing still finds it; with no ball coming it
 * goes back to the middle. Pure.
 */
export function autoTargetX(s: TennisState, seat: Seat): number {
  const contact = predictContact(s, seat);
  if (!contact) {
    const heading = seat === 0 ? s.ball.vz > 0 : s.ball.vz < 0;
    const coming = s.phase === "rally" && s.lastHitter !== seat && heading;
    return coming ? s.players[seat].targetX : 0;
  }
  const b = contact.ball;
  // +1: the ball is to end up on the +x side of the player
  const forehandSide = seat === 0 ? 1 : -1;
  const side = Math.abs(b.vx) >= AUTO_STRAIGHT_VX ? Math.sign(b.vx) : b.x !== 0 ? Math.sign(b.x) : forehandSide;
  return clamp(b.x - side * AUTO_OFFSET, -maxPlayerX, maxPlayerX);
}

// A camera swing counts as a shot at the ball from this long before the ball
// reaches you: the server's hit window plus a little for the swing message to
// arrive. Anything earlier is a wind-up and isn't sent.
export const SWING_LEAD_TICKS = Math.round(HIT_WINDOW_S / DT) + 3;

/**
 * Whether a swing now would be a shot at the ball: "ready" when it reaches
 * `seat`'s baseline within SWING_LEAD_TICKS (or is already in the hit window),
 * "early" when it is still on its way, "none" when no ball is coming.
 */
export function swingTiming(s: TennisState, seat: Seat): "ready" | "early" | "none" {
  const contact = predictContact(s, seat);
  if (!contact) return "none";
  return contact.ticks <= SWING_LEAD_TICKS ? "ready" : "early";
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
  // the flight from contact to touchdown, sampled every few ticks, for the arc
  path: { x: number; y: number; z: number }[];
}

const PATH_EVERY_TICKS = 3;

/**
 * Where `seat`'s next shot would first touch down with this aim and level,
 * using `kind` or, if not given, the swing that suits the ball's side (a
 * wrong-side swing at a coming ball is a miss, so it is reported not `in`).
 * When the ball is coming at
 * them, it is hit at the predicted contact point and matches a real hit there
 * exactly. Otherwise (serve, their own shot still travelling, a ball that won't
 * reach them) it is hit from where they stand at a comfortable height, so aim
 * always has somewhere to show. A guide for the reticle; the server decides
 * the real hit. Pure: `s` is not modified.
 */
export function predictLanding(
  s: TennisState,
  seat: Seat,
  aim: number,
  level: Level,
  hand: Hand = "right",
  kind?: SwingKind,
): Landing {
  const playerX = s.players[seat].x;
  const contact = predictContact(s, seat);
  const b = contact ? contact.ball : { x: playerX, y: IDEAL_CONTACT_Y, z: seatZ(seat), vx: 0, vy: 0, vz: 0 };
  // a held grip that doesn't suit the coming ball misses: shown as not in
  const fits = !contact || !kind || kindFits(seat, playerX, b.x, kind, hand);
  launch(b, seat, aim, kind ?? naturalKind(seat, playerX, b.x, hand), level);
  const predicted = contact !== null;
  const path = [{ x: b.x, y: b.y, z: b.z }];
  for (let i = 1; i < 600; i++) {
    const event = moveBall(b);
    if (event !== null || i % PATH_EVERY_TICKS === 0) path.push({ x: b.x, y: b.y, z: b.z });
    if (event === "net") return { x: b.x, z: 0, in: false, net: true, farSide: false, predicted, path };
    if (event === "bounce") {
      const inBounds = Math.abs(b.x) <= COURT.halfW && Math.abs(b.z) <= COURT.halfL;
      const farSide = Math.sign(b.z) === (seat === 0 ? -1 : 1);
      return { x: b.x, z: b.z, in: inBounds && farSide && fits, net: false, farSide, predicted, path };
    }
  }
  // unreachable: a launched ball always comes down within 10 s
  return { x: b.x, z: b.z, in: false, net: false, farSide: false, predicted, path };
}
