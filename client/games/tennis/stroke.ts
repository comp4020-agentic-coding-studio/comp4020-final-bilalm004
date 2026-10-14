// The canned forehand and backhand, as joint angles over time. Pure numbers,
// so the two strokes can be told apart by a test, not only by eye.
//
// Angles are for a right-handed player in the character's own frame (see
// character.ts): `armX` raises the racket arm forward, `armY` swings it
// around the body (positive across to the left), `bodyY` turns the shoulders
// (positive: counter-clockwise seen from above). A left-hander is the mirror.
//
// The two strokes are built to read differently from behind:
// - forehand: racket taken back low on the racket side, shoulders turned
//   away, low-to-high through contact in front, finishing high over the
//   opposite shoulder with a big turn toward the net;
// - backhand: racket taken back across the body by the opposite hip, off
//   hand on the throat and back to the net, swung out to the racket side,
//   finishing with the arm extended and the off arm flung back; the shoulders
//   turn the other way and stay more side-on.

/** How long a canned stroke lasts on screen. */
export const STROKE_MS = 420;
/** Where in the stroke (0..1) the racket meets the ball. */
export const CONTACT = 0.45;

export interface StrokePose {
  armX: number;
  armY: number;
  /** forearm bend at the elbow */
  elbow: number;
  /** racket angle at the wrist; PI carries on along the forearm */
  wristX: number;
  /** racket face about its shaft: PI/2 forehand face, -PI/2 backhand face */
  roll: number;
  bodyY: number;
  /** off arm: raised forward, and swung across */
  offX: number;
  offY: number;
}

type Key = [t: number, pose: StrokePose];

const P = Math.PI;

const FOREHAND: Key[] = [
  [0, { armX: 0.75, armY: -1.6, elbow: 0.35, wristX: P + 0.7, roll: P / 2, bodyY: -0.75, offX: 1.35, offY: -0.5 }],
  [CONTACT, { armX: 1.2, armY: -0.35, elbow: 0.1, wristX: P + 0.3, roll: P / 2, bodyY: -0.05, offX: 0.7, offY: -0.2 }],
  [0.8, { armX: 1.7, armY: 1.75, elbow: 0.5, wristX: P + 1.1, roll: P / 2, bodyY: 0.5, offX: 0.35, offY: 0.3 }],
  [1, { armX: 1.7, armY: 1.75, elbow: 0.5, wristX: P + 1.1, roll: P / 2, bodyY: 0.5, offX: 0.35, offY: 0.3 }],
];

const BACKHAND: Key[] = [
  [0, { armX: 0.7, armY: 1.6, elbow: 0.5, wristX: P + 0.3, roll: -P / 2, bodyY: 1.05, offX: 1.0, offY: -0.9 }],
  [CONTACT, { armX: 1.3, armY: 0.45, elbow: 0.15, wristX: P + 0.3, roll: -P / 2, bodyY: 0.35, offX: 0.55, offY: -0.2 }],
  [0.8, { armX: 1.9, armY: -1.35, elbow: 0, wristX: P + 0.9, roll: -P / 2, bodyY: -0.2, offX: -0.7, offY: 0.3 }],
  [1, { armX: 1.9, armY: -1.35, elbow: 0, wristX: P + 0.9, roll: -P / 2, bodyY: -0.2, offX: -0.7, offY: 0.3 }],
];

export interface ShotLabel {
  /** "FOREHAND" or "BACKHAND": the stroke that was played */
  text: string;
  /** a second line, or "" */
  note: string;
  /** the swing was the wrong stroke for the side the ball was on */
  wrongSide: boolean;
}

/**
 * What the big label on a shot says. A wrong-side miss names the stroke that
 * was played (struck through on screen) and the one the ball needed, so the
 * player sees why it missed rather than only that it did.
 */
export function shotLabel(kind: "forehand" | "backhand", miss: string | null, who = ""): ShotLabel {
  const text = kind.toUpperCase();
  if (miss === "wrong side") {
    const other = kind === "forehand" ? "backhand" : "forehand";
    return { text, note: `Wrong side: ball was on your ${other}`, wrongSide: true };
  }
  // a dead ball (task 12): it had already landed out, or bounced twice
  if (miss === "out") return { text, note: "Too late: the ball had already landed out", wrongSide: false };
  if (miss === "two bounces") return { text, note: "Too late: the ball had already bounced twice", wrongSide: false };
  return { text, note: who, wrongSide: false };
}

const smooth = (x: number) => x * x * (3 - 2 * x);

/** The pose `t` (0..1, clamped) through a forehand or a backhand. */
export function strokePose(t: number, backhand: boolean): StrokePose {
  const keys = backhand ? BACKHAND : FOREHAND;
  const tt = Math.max(0, Math.min(1, t));
  let i = 0;
  while (i < keys.length - 2 && tt > keys[i + 1][0]) i++;
  const [t0, a] = keys[i];
  const [t1, b] = keys[i + 1];
  const k = smooth(t1 > t0 ? (tt - t0) / (t1 - t0) : 1);
  const out = {} as StrokePose;
  for (const name of Object.keys(a) as (keyof StrokePose)[]) out[name] = a[name] + (b[name] - a[name]) * k;
  return out;
}
