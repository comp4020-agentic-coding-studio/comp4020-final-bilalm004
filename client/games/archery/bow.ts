// Holding a bow in front of the camera (task 22). Pure: landmarks in, aim,
// draw and release out, so it is unit tested on synthetic sequences
// (spec/archery-bow.test.ts), like tennis's pose.ts.
//
// The front (aiming) hand aims: where its wrist sits against the shoulders
// sets the sight. The back hand draws: how far apart the wrists are, in
// shoulder-widths, is the draw. Letting go is opening the drawing hand's
// fingers (read by the hand model), as you would let go of a string. Without
// a hand reading, the back hand snapping toward the front one shoots
// instead; bringing it back slowly lets the draw down with no arrow.
import { AIM, MIN_DRAW } from "../../../shared/games/archery/sim.ts";
import type { Hand } from "../../../shared/games/tennis/sim.ts";
import { LM, OneEuro, bodyFrame, wrist } from "../../input/camera/pose.ts";
import type { Point } from "../../input/camera/pose.ts";

export interface BowConfig {
  /** Wrists this far apart along the shoulder line (shoulder-widths) are an empty draw... */
  restSpan: number;
  /** ...and this far apart a full one. */
  fullSpan: number;
  /** The bow hand this far from its rest spot (shoulder-widths) is the aim limit. */
  aimReach: number;
  /** Where the bow hand rests, in shoulder-widths: straight out in front, at shoulder height. */
  restAcross: number;
  restDown: number;
  /** A drop in draw this fast (draw per second) is a release; slower lets it down. */
  releaseSpeed: number;
  /** Over at most this long (ms), and to at most this much draw. */
  releaseWindowMs: number;
  releaseTo: number;
  /** Opening the drawing hand by this much more than its closed grip (handOpenness, 0..1) shoots. */
  openBy: number;
  /** ...and to at least this openness: a relaxed, half-curled hand never fires on its own. */
  openAt: number;
}

// GUESSES to be playtested, like tennis's swing thresholds.
export const DEFAULT_BOW: BowConfig = {
  // playtest: the straight-line span moved with aiming up and down and read
  // weak side-on; now only the gap along the shoulders counts. About a
  // shoulder width of pull is a full draw.
  restSpan: 0.3,
  fullSpan: 1.3,
  // playtest: 0.9 aimed too fast; twice the hand travel for the same aim
  aimReach: 1.8,
  restAcross: 0,
  restDown: 0.3,
  releaseSpeed: 4,
  releaseWindowMs: 250,
  releaseTo: 0.15,
  openBy: 0.3,
  openAt: 0.6,
};

/** A drawing hand lost for this long keeps its last openness. */
export const HAND_HOLD_MS = 300;

// hand model points (MediaPipe's 21-point hand): each finger's knuckle and tip
const HAND = { wrist: 0, fingers: [[5, 8], [9, 12], [13, 16], [17, 20]] } as const;

/**
 * How open a hand is, 0 (a fist) to 1 (flat open), from how far each finger
 * folds back: the angle between wrist->knuckle and knuckle->tip, averaged
 * over four fingers. Angles inside the hand, in 3D where the model gives
 * depth, so it holds when the hand points at the camera (as a drawing hand
 * does) and at any distance. A fist folds about 150 degrees, an open hand
 * about 15.
 */
export function handOpenness(points: readonly Point[], aspect: number): number | null {
  const at = (i: number) => (points[i] ? { x: points[i].x * aspect, y: points[i].y, z: (points[i].z ?? 0) * aspect } : null);
  const w = at(HAND.wrist);
  if (!w) return null;
  let sum = 0;
  for (const [k, t] of HAND.fingers) {
    const knuckle = at(k);
    const tip = at(t);
    if (!knuckle || !tip) return null;
    const a = { x: knuckle.x - w.x, y: knuckle.y - w.y, z: knuckle.z - w.z };
    const b = { x: tip.x - knuckle.x, y: tip.y - knuckle.y, z: tip.z - knuckle.z };
    const la = Math.hypot(a.x, a.y, a.z);
    const lb = Math.hypot(b.x, b.y, b.z);
    if (la < 1e-5 || lb < 1e-5) return null;
    const cos = (a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb);
    // folded back fully (cos -1) is 0, straight on (cos 1) is 1
    sum += (cos + 1) / 2;
  }
  return sum / HAND.fingers.length;
}

/**
 * The drawing hand's openness, from the hand model's hands: the one whose
 * wrist is nearest the pose's drawing wrist (not MediaPipe's left/right
 * label, which a mirrored image swaps). Null if no hand is near it.
 */
export function drawHandOpenness(lm: readonly Point[], hands: readonly { points: readonly Point[] }[], aspect: number, bowHand: Hand): number | null {
  const frame = bodyFrame(lm, aspect);
  const pull = lm[bowHand === "right" ? LM.leftWrist : LM.rightWrist];
  if (!frame || !pull) return null;
  let best: { d: number; points: readonly Point[] } | null = null;
  for (const h of hands) {
    const w = h.points[HAND.wrist];
    if (!w) continue;
    const d = Math.hypot((w.x - pull.x) * aspect, w.y - pull.y) / frame.width;
    if (!best || d < best.d) best = { d, points: h.points };
  }
  // the hand model's wrist sits on the pose's, give or take; pulled back by the
  // face the two disagree most, so allow a shoulder and a half
  return best && best.d < 1.5 ? handOpenness(best.points, aspect) : null;
}

export interface BowReading {
  yaw: number;
  pitch: number;
  draw: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const other = (h: Hand): Hand => (h === "right" ? "left" : "right");

/**
 * One frame's sight and draw, or null if the shoulders or a hand aren't seen.
 * `bowHand`: the hand holding the bow (the other draws). Moving the bow hand
 * to the player's own left aims left whichever hand it is.
 */
export function readBow(lm: readonly Point[], aspect: number, bowHand: Hand, cfg: BowConfig = DEFAULT_BOW): BowReading | null {
  const frame = bodyFrame(lm, aspect);
  if (!frame) return null;
  const bow = wrist(lm, frame, bowHand, aspect);
  const pull = wrist(lm, frame, other(bowHand), aspect);
  if (!bow || !pull) return null;
  // `across` is positive toward the player's left, so left is negative yaw
  const yaw = clamp(-(bow.across - cfg.restAcross) / cfg.aimReach, -1, 1) * AIM.yaw;
  const up = clamp(-(bow.down - cfg.restDown) / cfg.aimReach, -1, 1);
  const pitch = up >= 0 ? up * AIM.pitchMax : -up * AIM.pitchMin;
  // the draw: how far apart the hands are along the shoulder line, so raising
  // or lowering the aiming hand doesn't change it
  const span = Math.abs(bow.across - pull.across);
  const draw = clamp((span - cfg.restSpan) / (cfg.fullSpan - cfg.restSpan), 0, 1);
  return { yaw, pitch, draw };
}

export type BowEvent =
  | { t: "aim"; yaw: number; pitch: number; draw: number }
  /** The aim and draw just before the snap, not the collapsed draw after it. */
  | { t: "release"; yaw: number; pitch: number; draw: number }
  | { t: "letdown" };

/**
 * Turns readings into aim updates, a release or a let-down. While drawn, the
 * drawing hand opening (by `openBy` past the most closed it has been this
 * draw) is the release, with the aim and draw of that moment. With no hand
 * reading, a fast fall in draw is the release instead, with the aim and draw
 * held just before the hands moved, so the snap itself can't spoil the shot.
 */
export class BowTracker {
  private cfg: BowConfig;
  private yaw = new OneEuro(0.8, 0.2);
  private pitch = new OneEuro(0.8, 0.2);
  // recent (time, reading) while drawn, newest last
  private history: { t: number; r: BowReading }[] = [];
  private drawn = false;
  // the most closed the drawing hand has been during this draw
  private grip: number | null = null;
  // the last openness read and when: a hand lost for a frame or two (turned
  // side-on by the face) keeps its last reading rather than reading nothing
  private lastOpen: { v: number; t: number } | null = null;

  constructor(cfg: BowConfig = DEFAULT_BOW) {
    this.cfg = cfg;
  }

  /** `open`: the drawing hand's openness this frame (handOpenness), or null if it isn't read. */
  update(r: BowReading | null, t: number, seen: number | null = null): BowEvent | null {
    if (seen !== null) this.lastOpen = { v: seen, t };
    const open = seen ?? (this.lastOpen && t - this.lastOpen.t <= HAND_HOLD_MS ? this.lastOpen.v : null);
    if (!r) {
      // the hands left the frame: nothing is shot, the draw is let down
      this.history = [];
      this.grip = null;
      const was = this.drawn;
      this.drawn = false;
      return was ? { t: "letdown" } : null;
    }
    const smooth = { yaw: this.yaw.filter(r.yaw, t), pitch: this.pitch.filter(r.pitch, t), draw: r.draw };
    this.history.push({ t, r: smooth });
    while (this.history.length > 0 && t - this.history[0].t > this.cfg.releaseWindowMs) this.history.shift();
    if (smooth.draw >= MIN_DRAW) this.drawn = true;
    if (this.drawn && open !== null) {
      this.grip = this.grip === null ? open : Math.min(this.grip, open);
      if (smooth.draw >= MIN_DRAW && open >= this.grip + this.cfg.openBy && open >= this.cfg.openAt) {
        // let go: the arrow goes with the fullest draw of the last moment,
        // in case the hand drifted forward as it opened
        const peak = this.history.reduce((a, b) => (b.r.draw > a.r.draw ? b : a));
        this.drawn = false;
        this.grip = null;
        this.history = [];
        return { t: "release", yaw: smooth.yaw, pitch: smooth.pitch, draw: peak.r.draw };
      }
    }
    if (this.drawn && smooth.draw <= this.cfg.releaseTo) {
      this.grip = null;
      this.drawn = false;
      // the fullest draw in the window, and how fast it fell from there
      const peak = this.history.reduce((a, b) => (b.r.draw > a.r.draw ? b : a));
      const dt = (t - peak.t) / 1000;
      const speed = dt > 0 ? (peak.r.draw - smooth.draw) / dt : Infinity;
      this.history = [];
      if (peak.r.draw >= MIN_DRAW && speed >= this.cfg.releaseSpeed) return { t: "release", ...peak.r };
      return { t: "letdown" };
    }
    return { t: "aim", ...smooth };
  }

  reset(): void {
    this.history = [];
    this.drawn = false;
    this.grip = null;
    this.lastOpen = null;
    this.yaw.reset();
    this.pitch.reset();
  }
}
