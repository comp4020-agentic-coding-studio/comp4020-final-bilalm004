import { COURT, launch, seatZ } from "./sim.ts";
import type { Ball, Hand, Level } from "./sim.ts";

// Training's ball machine (task 5). It stands on the far baseline (seat 1)
// and feeds balls to seat 0 with the sim's own launch(), so every feed is a
// shot a real opponent could play. Pure and deterministic: a feed depends only
// on the seed, the drill, the feed's number, the hand and (for movement) where
// the player stands, so the same seed gives the same balls.

/**
 * What a lesson needs from the machine:
 * - forehand / backhand: angled to that side; auto-move sets the stroke up.
 * - timing: nearly straight, met a little to the forehand side, so early
 *   (cross-court) and late (down the line) both land in at medium.
 * - movement: slow and wide, away from the player, out of reach unless they move.
 * - mixed: forehand and backhand in turn.
 */
export type Drill = "forehand" | "backhand" | "timing" | "movement" | "mixed";
export const DRILLS: readonly Drill[] = ["forehand", "backhand", "timing", "movement", "mixed"];

export interface Feed {
  // where on the far baseline the ball leaves from
  x: number;
  // the machine's aim, -1..1 in world x, and strength, as for a swing
  dirX: number;
  level: Level;
}

/** A number in [0, 1) from the seed, the feed and a salt; the same inputs always give the same number. */
function unit(seed: number, i: number, salt: number): number {
  let t = (seed ^ Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
  t = (t + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const DRILL_SALT: Record<Drill, number> = { forehand: 1, backhand: 2, timing: 3, movement: 4, mixed: 5 };

/**
 * Feed number `i` of `drill`. `hand` decides which side is the forehand for
 * seat 0 (a right-hander's is +x). `playerX` only matters for movement: the
 * ball goes to the side away from the player, so it always takes a run.
 */
export function machineFeed(seed: number, drill: Drill, i: number, hand: Hand, playerX = 0): Feed {
  const r1 = unit(seed, i, DRILL_SALT[drill] * 2);
  const r2 = unit(seed, i, DRILL_SALT[drill] * 2 + 1);
  const fore = hand === "right" ? 1 : -1;
  const angled = (side: number): Feed => ({ x: side * (-1.5 + 2 * r1), dirX: side * (0.3 + 0.3 * r2), level: 1 });
  switch (drill) {
    case "forehand":
      return angled(fore);
    case "backhand":
      return angled(-fore);
    case "mixed":
      return angled(i % 2 === 0 ? fore : -fore);
    case "timing":
      return { x: fore * (0.3 + 0.4 * r1), dirX: fore * 0.06 * r2, level: 1 };
    case "movement": {
      // to the side away from the player, crossing their baseline 2.4-3.2 m
      // from the middle, at medium pace (about 1.6 s of flight)
      const side = Math.abs(playerX) > 0.5 ? -Math.sign(playerX) : r2 < 0.5 ? -1 : 1;
      const cross = side * (2.4 + 0.8 * r1);
      const x = cross * 0.4;
      // sideways travel over the 22 m at medium: dirX x AIM_SPREAD[1] x 22 m
      return { x, dirX: (cross - x) / (0.2 * 2 * COURT.halfL), level: 1 };
    }
  }
}

/**
 * Where the movement drill puts the player before feed `i`: out of position,
 * near a sideline, alternating sides. docs/reaction-time.md: from the middle
 * auto-move reaches every in-bounds ball, so a drill from there needs no
 * running; from near the edge a ball to the far side does.
 */
export function movementStart(i: number): number {
  return (i % 2 === 0 ? 1 : -1) * 4.2;
}

/** The ball as it leaves the machine: from the far baseline, launched as seat 1 would hit it. */
export function feedBall(feed: Feed): Ball {
  const b: Ball = { x: feed.x, y: 1, z: seatZ(1), vx: 0, vy: 0, vz: 0 };
  launch(b, 1, feed.dirX, "forehand", feed.level);
  return b;
}

// the machine stands still on its baseline; this keeps the drawn machine at the ball
export const MACHINE_Z = -COURT.halfL;
