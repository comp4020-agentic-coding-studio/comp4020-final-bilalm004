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
  /** Why it matters, in two or three short sentences (behind a "Why?" toggle). Figures from docs/reaction-time.md. */
  why?: string;
}

export const LESSONS: readonly Lesson[] = [
  {
    id: "swing",
    title: "Swing",
    how: "Swing as the ball reaches you. Space, or swing your arm.",
    drill: "timing",
  },
  {
    id: "forehand",
    title: "Forehand",
    how: "Balls come to your forehand side. Palm to the screen, then swing.",
    drill: "forehand",
  },
  {
    id: "backhand",
    title: "Backhand",
    how: "Now your backhand side. Back of your hand to the screen, then swing.",
    drill: "backhand",
  },
  {
    id: "timing",
    title: "Timing sets direction",
    how: "Swing early, on time and late. Land one of each in.",
    drill: "timing",
    why: "Early goes cross-court, on time straight, late down the line. Hit away from your opponent and they have to run.",
  },
  {
    id: "strength",
    title: "Strength sets speed",
    how: "Land a light, a medium, then a hard one in. Keys 1, 2, 3.",
    drill: "timing",
    why: "Harder is faster and deeper: about 2.0 s light, 1.6 s medium and 1.2 s hard for your opponent to reach it. Hard and wide can go out.",
  },
  {
    id: "movement",
    title: "Move yourself",
    how: "Auto-move is off. Run to the ball: A / D, or lean.",
    drill: "movement",
    optional: true,
    why: "Make your opponent run out of position and out of time. From the middle you reach everything; from the sideline a hard ball to the far side can beat you.",
  },
  {
    id: "targets",
    title: "Targets (optional)",
    how: "Land three balls in the lit circle.",
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

const TIMING_ORDER: readonly Timing[] = ["early", "ontime", "late"];
const TIMING_ASK: Record<Timing, string> = { early: "swing early, and land it in", ontime: "swing on time, and land it in", late: "swing late, and land it in" };

/**
 * The one shot a step asks for next. The timing step wants early, then on
 * time, then late; the strength step a light swing, then a hard one. Only a
 * hit that matches what is asked, and lands in, counts; the sequence is in
 * order, so an on-time hit when early is asked for moves nothing on. Null
 * once the step has everything it asked for.
 */
export function wantedShot(id: "timing" | "strength", rec: LessonRecord): { timing: Timing } | { level: Level } | null {
  if (id === "timing") {
    let at = 0;
    for (const r of rec.shots) if (at < TIMING_ORDER.length && r.timing === TIMING_ORDER[at] && landedIn(r)) at++;
    return at < TIMING_ORDER.length ? { timing: TIMING_ORDER[at] } : null;
  }
  const order: readonly Level[] = [0, 1, 2];
  let at = 0;
  for (const r of rec.shots) if (at < order.length && r.level === order[at] && landedIn(r)) at++;
  return at < order.length ? { level: order[at] } : null;
}

const TIMING_NAME: Record<Timing, string> = { early: "early", ontime: "on time", late: "late" };
const LEVEL_NAME = ["light", "medium", "hard"] as const;

/**
 * Why a hit didn't move the step on, in a few words, when the step asked for
 * something else. Null when it was the shot asked for (or nothing is asked).
 */
export function wrongShotNote(id: "timing" | "strength", report: ShotReport, want: { timing: Timing } | { level: Level } | null): string | null {
  if (!want) return null;
  if (id === "timing" && "timing" in want) {
    if (report.timing === want.timing) return report.landing && !report.landing.in ? "Right timing, but it went out. Land it in." : null;
    return report.timing === null ? null : `That was ${TIMING_NAME[report.timing]}. We want ${TIMING_NAME[want.timing]}.`;
  }
  if (id === "strength" && "level" in want) {
    if (report.level === want.level) return report.landing && !report.landing.in ? "Right strength, but it went out. Land it in." : null;
    return `That was ${LEVEL_NAME[report.level]}. We want ${LEVEL_NAME[want.level]}.`;
  }
  return null;
}

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
      const want = wantedShot("timing", rec);
      return want && "timing" in want ? { done: false, text: `Now: ${TIMING_ASK[want.timing]}` } : { done: true, text: "Early, on time and late: all in" };
    }
    case "strength": {
      const want = wantedShot("strength", rec);
      return want && "level" in want ? { done: false, text: `Now: a ${LEVEL_NAME[want.level]} swing, landing in` } : { done: true, text: "Light, medium and hard: all in" };
    }
    case "movement":
      return rec.shots.length > 0 ? { done: true, text: "You got there" } : { done: false, text: "Reach a wide ball and hit it" };
    case "targets":
      return count(rec.targets, 3, "Targets hit");
  }
}

/** The steps training needs; auto-move stays on through all of them. */
export const REQUIRED_LESSONS: readonly Lesson[] = LESSONS.filter((l) => !l.optional);

/** Training is complete once every required step is done (movement and targets are extras). */
export function trainingComplete(done: ReadonlySet<LessonId>): boolean {
  return REQUIRED_LESSONS.every((l) => done.has(l.id));
}

/** Asked once, after the required steps (user's call: movement is optional). */
export const MOVEMENT_OFFER = {
  question: "Practise moving yourself?",
  yes: "Yes",
  no: "No thanks",
} as const;

/**
 * What follows step `id`: the next required step (a skipped one is not
 * repeated), then the movement offer once the required steps are behind
 * you, then the end. Movement and targets are optional and end the run.
 */
export function afterLesson(id: LessonId):{ next: LessonId } | { offer: "movement" } | { finished: true } {
  const i = REQUIRED_LESSONS.findIndex((l) => l.id === id);
  if (i < 0) return { finished: true };
  const next = REQUIRED_LESSONS[i + 1];
  return next ? { next: next.id } : { offer: "movement" };
}

/** The optional step's circles on the machine's half, one lit at a time. */
export const TARGETS: readonly { x: number; z: number }[] = [
  { x: -2.2, z: -6.5 },
  { x: 2.2, z: -6.5 },
  { x: 0, z: -4 },
];
export const TARGET_RADIUS = 1.5;
