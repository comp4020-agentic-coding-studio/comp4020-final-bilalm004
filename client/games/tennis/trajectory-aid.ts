import { DEFAULT_SWING, levelFromSpeed } from "../../input/camera/pose.ts";
import { cloneState, hitWindowDistance, kindFits, naturalKind, predictContact, seatZ, step } from "../../../shared/games/tennis/sim.ts";
import type { Hand, Level, Seat, SwingKind, TennisState } from "../../../shared/games/tennis/sim.ts";

// The trajectory aid's logic, kept pure so it can be tested: which of the
// three timing arcs is lit, where the meter's marker sits, where the depth
// ticks go. Every arc comes from stepping a copy of the shared sim with a
// timing-aimed swing, so it is what the server would do with that swing at
// that moment. A guide only: the server rewinds to the swing and decides.

export const TIMINGS = ["early", "ontime", "late"] as const;
export type Timing = (typeof TIMINGS)[number];
// The moment each arc is hit at, as a share of the hit window (-1 earliest, 1
// latest): the middle of each third.
export const TIMING_U = [-2 / 3, 0, 2 / 3] as const;

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface AidLanding {
  x: number;
  z: number;
  // in bounds on the opponent's half
  in: boolean;
  // it cleared the net and first came down on the opponent's half (in or out)
  farSide: boolean;
}

export interface AidArc extends AidLanding {
  timing: Timing;
  // contact to first touchdown, every few ticks
  path: Point3[];
}

export type Ticks = [AidLanding, AidLanding, AidLanding];

export interface TimingAid {
  kind: SwingKind;
  // by timing (early, on time, late). A moment is null once the ball can no
  // longer be hit then: a ball that lands out goes dead at the bounce, so only
  // the moments before it have an arc (task 12 rule: it can be volleyed until then)
  arcs: [AidArc | null, AidArc | null, AidArc | null];
  // by timing (early, on time, late), where light, medium and hard land
  ticks: [Ticks | null, Ticks | null, Ticks | null];
}

const PATH_EVERY_TICKS = 3;
const MAX_TICKS = 600;

/**
 * Where the ball is in `seat`'s hit window: -1 at the earliest a swing
 * connects, 0 at the baseline, 1 at the latest, beyond either end outside it.
 * The same measure `timingAim` turns into a direction. Null when no ball is
 * coming at `seat`.
 */
export function windowPosition(s: TennisState, seat: Seat): number | null {
  if (s.phase !== "rally" || s.lastHitter === seat) return null;
  const b = s.ball;
  const heading = seat === 0 ? b.vz > 0 : b.vz < 0;
  if (!heading) return null;
  const past = (b.z - seatZ(seat)) * Math.sign(seatZ(seat));
  return past / hitWindowDistance(b);
}

/** The arc to light for a ball at window position `u`: its third of the window, or none outside it. */
export function litTiming(u: number | null): Timing | null {
  if (u === null || u < -1 || u > 1) return null;
  if (u < -1 / 3) return "early";
  if (u > 1 / 3) return "late";
  return "ontime";
}

/** The meter marker, 0 (early edge) to 1 (late edge); pinned to the ends outside the window. */
export function meterPosition(u: number | null): number | null {
  if (u === null) return null;
  return (Math.min(1, Math.max(-1, u)) + 1) / 2;
}

/** Records a flight from now to its first touchdown (or the net). */
function flight(c: TennisState, seat: Seat): { path: Point3[]; landing: AidLanding } {
  const path: Point3[] = [{ x: c.ball.x, y: c.ball.y, z: c.ball.z }];
  const before = c.lastBounce?.tick;
  const farSign = seat === 0 ? -1 : 1;
  for (let i = 1; i < MAX_TICKS; i++) {
    const ev = step(c, []);
    const bounced = c.lastBounce !== null && c.lastBounce.tick !== before;
    if (bounced) {
      const lb = c.lastBounce!;
      path.push({ x: lb.x, y: 0, z: lb.z });
      const farSide = Math.sign(lb.z) === farSign;
      return { path, landing: { x: lb.x, z: lb.z, in: farSide && lb.in, farSide } };
    }
    if (ev.some((e) => e.type === "point")) {
      // into the net: the point is scored before the ball lands
      const last = path.at(-1)!;
      path.push({ x: c.ball.x, y: c.ball.y, z: 0 });
      return { path, landing: { x: last.x, z: 0, in: false, farSide: false } };
    }
    if (i % PATH_EVERY_TICKS === 0) path.push({ x: c.ball.x, y: c.ball.y, z: c.ball.z });
  }
  const last = path.at(-1)!;
  return { path, landing: { x: last.x, z: last.z, in: false, farSide: false } };
}

/**
 * Runs a copy of `s` on to window position `u` (or uses now, if that moment
 * has passed) and swings there, aiming by timing. The player is put at the
 * ball: the aid shows where timing sends it, not whether you got there.
 */
function shoot(s: TennisState, seat: Seat, u: number, kind: SwingKind, level: Level, hand: Hand): { path: Point3[]; landing: AidLanding } | null {
  const c = cloneState(s);
  for (let i = 0; i < MAX_TICKS; i++) {
    const now = windowPosition(c, seat);
    if (now === null || now > 1) return null;
    if (now >= u) break;
    step(c, []);
  }
  c.players[seat] = { x: c.ball.x, targetX: c.ball.x };
  // held there for the swing, whatever the seat's movement mode
  c.movement[seat] = { mode: "tilt", manual: false };
  const contact = { x: c.ball.x, y: c.ball.y, z: c.ball.z };
  const ev = step(c, [{ t: "swing", seat, dirX: 0, kind, level, hand, timingAim: true }]);
  if (!ev.some((e) => e.type === "swing" && e.outcome === "hit")) return null;
  const f = flight(c, seat);
  f.path[0] = contact;
  return f;
}

/**
 * The three arcs (early, on time, late) for the ball coming at `seat`, hit
 * at `level` with `kind` (or, without a grip, the swing that suits the ball),
 * plus light/medium/hard landings at each of those moments. An arc whose
 * moment has already passed is hit from the ball as it is now. Null when no
 * ball is coming or it can't be reached in the window.
 */
export function timingArcs(s: TennisState, seat: Seat, level: Level, hand: Hand, kind?: SwingKind): TimingAid | null {
  if (windowPosition(s, seat) === null) return null;
  const contact = predictContact(s, seat);
  const k = kind ?? naturalKind(seat, s.players[seat].x, contact ? contact.ball.x : s.ball.x, hand);
  const arcs: (AidArc | null)[] = [];
  const ticks: (AidLanding[] | null)[] = [];
  for (let i = 0; i < 3; i++) {
    const row: AidLanding[] = [];
    let arc: AidArc | null = null;
    for (const l of [0, 1, 2] as const) {
      const shot = shoot(s, seat, TIMING_U[i], k, l, hand);
      if (!shot) break;
      row.push(shot.landing);
      if (l === level) arc = { timing: TIMINGS[i], path: shot.path, ...shot.landing };
    }
    // a moment the ball can't be hit at (it has gone dead) has no arc and no ticks
    arcs.push(row.length === 3 ? arc : null);
    ticks.push(row.length === 3 ? row : null);
  }
  // nothing to show only if no moment can be hit at all
  if (arcs.every((a) => a === null)) return null;
  return { kind: k, arcs: arcs as TimingAid["arcs"], ticks: ticks as TimingAid["ticks"] };
}

/** The flight of a ball already hit, from where it is now to its first touchdown: the real arc. */
export function realArc(s: TennisState): Point3[] {
  const c = cloneState(s);
  const hitter = (c.lastHitter ?? 0) as Seat;
  return flight(c, hitter).path;
}

/**
 * Where a peak wrist speed sits on the depth ticks: 0 light, 1 medium, 2 hard,
 * sliding in between. The tick boundaries (0.5 and 1.5) fall on the
 * light/medium and medium/hard thresholds.
 */
export function strengthPosition(peak: number, thresholds: readonly [number, number]): number {
  const [a, b] = thresholds;
  const pos = peak <= a ? (peak / a) * 0.5 : 0.5 + (peak - a) / (b - a);
  return Math.min(2, Math.max(0, pos));
}

export interface ShownStrength {
  level: Level;
  // 0..2, where the highlight sits between the light, medium and hard ticks
  position: number;
  // sliding with a camera swing in progress
  live: boolean;
}

/**
 * The strength to highlight: the last swing's level, or during a camera swing
 * the level the peak speed so far would give (a guide; the swing decides at
 * its end). Before any swing, medium.
 */
export function shownStrength(
  last: Level | null,
  peak: number | null,
  thresholds: readonly [number, number],
  hysteresis = DEFAULT_SWING.hysteresis,
): ShownStrength {
  if (peak !== null) return { level: levelFromSpeed(peak, thresholds, last, hysteresis), position: strengthPosition(peak, thresholds), live: true };
  const level = last ?? 1;
  return { level, position: level, live: false };
}

export interface StanceHint {
  /** The stroke the next swing will be: the grip held (camera) or the one the ball's side calls for (keys). */
  kind: SwingKind;
  /** The held grip doesn't fit the ball's side, so the swing would be a "wrong side" miss. */
  wrong: boolean;
  /** The stroke the ball needs, when the grip is wrong. */
  needs?: SwingKind;
  /** What to show. */
  text: string;
}

const KIND_NAME: Record<SwingKind, string> = { forehand: "Forehand", backhand: "Backhand" };

/**
 * Which stroke your next swing will be, and whether the grip you hold is wrong
 * for the ball's side. Judged by the sim's own rule (`kindFits`: either stroke
 * within a short distance of you, otherwise the one the ball's side calls for)
 * at the place the ball will cross your baseline, which is where you hit it.
 * Keys and a camera that can't read your hand (`grip` null) get the stroke the
 * ball calls for and never a warning. Null when no ball is coming at you.
 */
export function stanceHint(s: TennisState, seat: Seat, hand: Hand, grip: SwingKind | null): StanceHint | null {
  if (windowPosition(s, seat) === null) return null;
  const at = predictContact(s, seat)?.ball.x ?? s.ball.x;
  const me = s.players[seat].x;
  const needs = naturalKind(seat, me, at, hand);
  if (grip === null) return { kind: needs, wrong: false, text: KIND_NAME[needs] };
  if (kindFits(seat, me, at, grip, hand)) return { kind: grip, wrong: false, text: KIND_NAME[grip] };
  return { kind: grip, wrong: true, needs, text: `${KIND_NAME[grip]} grip: the ball needs a ${needs}` };
}

