import { LEVEL_NAMES } from "../../../shared/games/tennis/sim.ts";
import type { Hand, Level, Miss, SwingKind } from "../../../shared/games/tennis/sim.ts";
import type { Drill } from "../../../shared/games/tennis/machine.ts";
import type { Timing } from "./trajectory-aid.ts";

// Training's lessons (task 5), kept pure so they can be tested: the steps,
// what completes each one, and the words said after every swing. Training
// is always seat 0, viewed from behind, so world -x is the player's left.

export type LessonId = "swing" | "forehand" | "backhand" | "timing" | "strength" | "movement" | "targets";

export interface Lesson {
  id: LessonId;
  title: string;
  /** What to do, for keys and for the camera. */
  how: string;
  /** What the ball machine feeds during this step. */
  drill: Drill;
  /** Can be left out without the training counting as unfinished. */
  optional?: boolean;
}

export const LESSONS: readonly Lesson[] = [
  {
    id: "swing",
    title: "Camera check: swing",
    how: "Swing as the ball reaches you. Camera: a quick swing of your racket arm. Keys: Space (or tap Medium).",
    drill: "timing",
  },
  {
    id: "forehand",
    title: "Forehand",
    how: "The machine feeds your forehand side. Camera: palm to the screen, then swing. Keys pick the stroke for you.",
    drill: "forehand",
  },
  {
    id: "backhand",
    title: "Backhand",
    how: "Now your backhand side. Camera: turn the back of your hand to the screen, then swing. A forehand at this ball is a miss.",
    drill: "backhand",
  },
  {
    id: "timing",
    title: "Timing sets the direction",
    how: "Watch the meter: hit early to pull it cross-court, late to send it down the line. Land one of each in.",
    drill: "timing",
  },
  {
    id: "strength",
    title: "Strength sets the depth",
    how: "A light swing lands short, a hard one deep. Land a light and a hard one in. Keys: 1 light, 3 hard.",
    drill: "timing",
  },
  {
    id: "movement",
    title: "Moving yourself",
    how: "Auto-move is off for this step and the balls go wide. Hold A / D (or ◀ ▶). Camera: pick Move: lean under the preview and shift your shoulders.",
    drill: "movement",
  },
  {
    id: "targets",
    title: "Targets (optional)",
    how: "Land three balls in the lit circle. Mix timing and strength to reach each one.",
    drill: "timing",
    optional: true,
  },
];

export interface LandingSpot {
  x: number;
  z: number;
  // in bounds on the machine's half
  in: boolean;
  net: boolean;
}

/** One hit, as training saw it: when in the window, which stroke, how hard, and (once it lands) where. */
export interface ShotReport {
  // third of the hit window it was met in; null when aimed by hand (an arrow held)
  timing: Timing | null;
  kind: SwingKind;
  hand: Hand;
  level: Level;
  // the aim sent, used when aimed by hand
  dirX: number;
  landing: LandingSpot | null;
}

const TIMING_WORDS: Record<Timing, string> = { early: "Early", ontime: "On time", late: "Late" };

/**
 * "Early, cross-court to the left, medium, landed in". Direction is worked
 * out the way `timingAim` does it for seat 0: early pulls the ball across
 * the body, late pushes it the other way, and the grip and hand mirror it.
 */
export function shotFeedback(r: ShotReport): string {
  const strength = LEVEL_NAMES[r.level];
  let head: string;
  if (r.timing === null) {
    const side = r.dirX < -0.1 ? " to the left" : r.dirX > 0.1 ? " to the right" : " straight";
    head = `Aimed by hand${side}, ${strength}`;
  } else if (r.timing === "ontime") {
    head = `On time, straight, ${strength}`;
  } else {
    const u = r.timing === "early" ? -1 : 1;
    const toRight = u * (r.kind === "forehand" ? 1 : -1) * (r.hand === "right" ? 1 : -1);
    const side = toRight > 0 ? "to the right" : "to the left";
    const where = r.timing === "early" ? "cross-court" : "down the line";
    head = `${TIMING_WORDS[r.timing]}, ${where} ${side}, ${strength}`;
  }
  if (!r.landing) return head;
  return `${head}, ${r.landing.net ? "into the net" : r.landing.in ? "landed in" : "landed out"}`;
}

const MISS_WORDS: Record<Miss, string> = {
  "no ball": "No ball to hit yet",
  out: "That ball had already landed out",
  "two bounces": "That ball had bounced twice",
  early: "Too early: wait for the ball",
  late: "Too late: swing sooner",
  reach: "Out of reach: the ball was too far to the side",
  high: "Too high to reach",
  "wrong side": "Wrong side",
};

/** A missed swing in plain words; a wrong-side miss says which stroke the ball needed. */
export function missFeedback(miss: Miss, kind: SwingKind): string {
  if (miss === "wrong side") return `Wrong side: that ball needed a ${kind === "forehand" ? "backhand" : "forehand"}`;
  return MISS_WORDS[miss];
}

/** What has happened during the current step. */
export interface LessonRecord {
  // swings sent, hit or not
  swings: number;
  // hits, each filled in with its landing once it lands
  shots: ShotReport[];
  // landings inside the lit target
  targets: number;
}

export interface Progress {
  done: boolean;
  text: string;
}

const landedIn = (r: ShotReport) => r.landing !== null && r.landing.in;
const count = (n: number, of: number, what: string): Progress => ({ done: n >= of, text: `${what}: ${Math.min(n, of)} of ${of}` });

/** Whether step `id` is done, and how far along it is, from what the player actually did. */
export function lessonProgress(id: LessonId, rec: LessonRecord): Progress {
  switch (id) {
    case "swing":
      return rec.swings > 0 ? { done: true, text: "We saw your swing" } : { done: false, text: "Waiting for a swing" };
    case "forehand":
      return count(rec.shots.filter((r) => r.kind === "forehand").length, 2, "Forehands hit");
    case "backhand":
      return count(rec.shots.filter((r) => r.kind === "backhand").length, 2, "Backhands hit");
    case "timing": {
      const early = rec.shots.some((r) => r.timing === "early" && landedIn(r));
      const late = rec.shots.some((r) => r.timing === "late" && landedIn(r));
      return { done: early && late, text: `Early in: ${early ? "yes" : "not yet"} · Late in: ${late ? "yes" : "not yet"}` };
    }
    case "strength": {
      const light = rec.shots.some((r) => r.level === 0 && landedIn(r));
      const hard = rec.shots.some((r) => r.level === 2 && landedIn(r));
      return { done: light && hard, text: `Light in: ${light ? "yes" : "not yet"} · Hard in: ${hard ? "yes" : "not yet"}` };
    }
    case "movement":
      return rec.shots.length > 0 ? { done: true, text: "You got there" } : { done: false, text: "Reach a wide ball and hit it" };
    case "targets":
      return count(rec.targets, 3, "Targets hit");
  }
}

/** The optional step's circles on the machine's half, one lit at a time. */
export const TARGETS: readonly { x: number; z: number }[] = [
  { x: -2.2, z: -6.5 },
  { x: 2.2, z: -6.5 },
  { x: 0, z: -4 },
];
export const TARGET_RADIUS = 1.5;
