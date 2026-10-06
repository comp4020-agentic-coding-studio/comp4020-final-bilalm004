import type { Hand, Level, SwingKind } from "../../../shared/games/tennis/sim.ts";

// Pose landmarks to game input. Pure: no DOM, no MediaPipe, so it is unit
// tested on synthetic landmark sequences (spec/camera.test.ts).
//
// Everything is measured in shoulder-widths, so distance from the camera
// doesn't matter, and in a frame aligned with the shoulder line, so leaning
// doesn't leak into aim. Nothing here depends on whether the image is
// mirrored: sides come from MediaPipe's left/right labels, not image x.

export interface Point {
  x: number;
  y: number;
  visibility?: number;
}

// MediaPipe pose landmark indices
export const LM = { leftShoulder: 11, rightShoulder: 12, leftWrist: 15, rightWrist: 16 } as const;

const MIN_VISIBILITY = 0.5;

export interface Vec {
  x: number;
  y: number;
}

export interface BodyFrame {
  /** Roll of the shoulder line in degrees; positive when leaning to the player's right. */
  tilt: number;
  mid: Vec;
  /** Unit vector from the right shoulder to the left, in aspect-corrected image units. */
  across: Vec;
  /** Shoulder width in aspect-corrected image units. */
  width: number;
}

export interface Wrist {
  /** Along the shoulder line in shoulder-widths from the shoulder midpoint; positive toward the player's left. */
  across: number;
  /** Position relative to the shoulder midpoint in shoulder-widths, for speed. */
  pos: Vec;
}

const visible = (p: Point | undefined): p is Point => p !== undefined && (p.visibility ?? 1) >= MIN_VISIBILITY;
// landmarks are normalised separately in x and y; scale x so both are in image heights
const scaled = (p: Point, aspect: number): Vec => ({ x: p.x * aspect, y: p.y });
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function bodyFrame(lm: readonly Point[], aspect: number): BodyFrame | null {
  const l = lm[LM.leftShoulder];
  const r = lm[LM.rightShoulder];
  if (!visible(l) || !visible(r)) return null;
  const L = scaled(l, aspect);
  const R = scaled(r, aspect);
  const v = { x: L.x - R.x, y: L.y - R.y };
  const width = Math.hypot(v.x, v.y);
  if (width < 1e-3) return null;
  return {
    // image y points down, so the right shoulder dropping makes v.y negative
    tilt: (Math.atan2(-v.y, Math.abs(v.x)) * 180) / Math.PI,
    mid: { x: (L.x + R.x) / 2, y: (L.y + R.y) / 2 },
    across: { x: v.x / width, y: v.y / width },
    width,
  };
}

export function wrist(lm: readonly Point[], frame: BodyFrame, hand: Hand, aspect: number): Wrist | null {
  const w = lm[hand === "right" ? LM.rightWrist : LM.leftWrist];
  if (!visible(w)) return null;
  const p = scaled(w, aspect);
  const pos = { x: (p.x - frame.mid.x) / frame.width, y: (p.y - frame.mid.y) / frame.width };
  return { across: pos.x * frame.across.x + pos.y * frame.across.y, pos };
}

export interface TiltConfig {
  deadZone: number;
  /** Tilt beyond neutral, in degrees, that reaches the sideline. */
  fullTilt: number;
}

export const DEFAULT_TILT: TiltConfig = { deadZone: 1.5, fullTilt: 9 };

/** Shoulder tilt to a movement target, -1 (far left on screen) to 1 (far right). */
export function tiltToTarget(tilt: number, neutral: number, cfg: TiltConfig = DEFAULT_TILT): number {
  const d = tilt - neutral;
  const past = Math.max(0, Math.abs(d) - cfg.deadZone);
  if (past === 0) return 0;
  return Math.sign(d) * clamp(past / (cfg.fullTilt - cfg.deadZone), 0, 1);
}

/** Hand offset across the body that gives full aim, in shoulder-widths. */
export const AIM_RANGE = 0.8;

/** Racket-hand position to aim, -1 (left on screen) to 1 (right). */
export function aimFromHand(across: number, neutral: number): number {
  // the player faces the screen from behind their avatar, so their right is screen right
  return clamp((neutral - across) / AIM_RANGE, -1, 1);
}

/** One Euro filter (Casiez et al. 2012): smooth when still, responsive when moving. */
export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;

  constructor(minCutoff = 1, beta = 0.5, dCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value: number, t: number): number {
    if (this.x === null || t <= this.t) {
      if (this.x === null) this.x = value;
      this.t = t;
      return this.x;
    }
    const dt = (t - this.t) / 1000;
    this.t = t;
    const a = OneEuro.alpha(this.dCutoff, dt);
    this.dx = a * ((value - this.x) / dt) + (1 - a) * this.dx;
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x = OneEuro.alpha(cutoff, dt) * value + (1 - OneEuro.alpha(cutoff, dt)) * this.x;
    return this.x;
  }

  reset(): void {
    this.x = null;
    this.dx = 0;
  }
}

export interface SwingConfig {
  /** Wrist speed (shoulder-widths per second) that starts a swing. */
  start: number;
  /** Peak speeds separating light/medium and medium/hard. */
  thresholds: [number, number];
  /** Fraction a peak must clear a threshold by to change level from the last swing. */
  hysteresis: number;
  cooldownMs: number;
  maxMs: number;
}

export const DEFAULT_SWING: SwingConfig = {
  start: 2.5,
  thresholds: [5, 9],
  hysteresis: 0.1,
  cooldownMs: 300,
  maxMs: 600,
};

/**
 * Level from peak wrist speed. Near a threshold the last swing's level wins,
 * so a player swinging consistently doesn't flicker between two levels.
 */
export function levelFromSpeed(peak: number, thresholds: readonly [number, number], prev: Level | null, hysteresis: number): Level {
  let level = 0;
  for (let i = 0; i < 2; i++) {
    const bias = prev === null ? 1 : prev > i ? 1 - hysteresis : 1 + hysteresis;
    if (peak > thresholds[i] * bias) level = i + 1;
  }
  return level as Level;
}

/**
 * Crossing the body toward the off-hand side is a forehand; moving back out
 * toward the racket side is a backhand. `dAcross` is the wrist's movement along
 * the shoulder line, positive toward the player's left.
 */
export function classifyKind(dAcross: number, hand: Hand): SwingKind {
  const towardOffHand = hand === "right" ? dAcross >= 0 : dAcross <= 0;
  return towardOffHand ? "forehand" : "backhand";
}

export interface SwingEvent {
  level: Level;
  kind: SwingKind;
  peak: number;
  startedAt: number;
  at: number;
}

export class SwingDetector {
  private prev: { t: number; pos: Vec; across: number } | null = null;
  private active: { startedAt: number; startAcross: number; peak: number; peakAcross: number } | null = null;
  private lastEnd = -Infinity;
  private lastLevel: Level | null = null;
  cfg: SwingConfig;
  hand: Hand;

  constructor(cfg: SwingConfig, hand: Hand) {
    this.cfg = cfg;
    this.hand = hand;
  }

  get swinging(): boolean {
    return this.active !== null;
  }

  /** Feed one wrist sample. Returns whether a swing just started, and the swing if it just ended. */
  update(t: number, w: Wrist): { started: boolean; swing: SwingEvent | null } {
    const prev = this.prev;
    this.prev = { t, pos: w.pos, across: w.across };
    if (!prev || t <= prev.t) return { started: false, swing: null };
    const speed = Math.hypot(w.pos.x - prev.pos.x, w.pos.y - prev.pos.y) / ((t - prev.t) / 1000);

    if (!this.active) {
      if (speed < this.cfg.start || t - this.lastEnd < this.cfg.cooldownMs) return { started: false, swing: null };
      this.active = { startedAt: prev.t, startAcross: prev.across, peak: speed, peakAcross: w.across };
      return { started: true, swing: null };
    }

    const a = this.active;
    if (speed > a.peak) {
      a.peak = speed;
      a.peakAcross = w.across;
    }
    // contact: the wrist has clearly slowed after its peak, or the swing ran too long
    if (speed < Math.max(this.cfg.start, a.peak * 0.6) || t - a.startedAt > this.cfg.maxMs) {
      this.active = null;
      this.lastEnd = t;
      const level = levelFromSpeed(a.peak, this.cfg.thresholds, this.lastLevel, this.cfg.hysteresis);
      this.lastLevel = level;
      const kind = classifyKind(a.peakAcross - a.startAcross, this.hand);
      return { started: false, swing: { level, kind, peak: a.peak, startedAt: a.startedAt, at: t } };
    }
    return { started: false, swing: null };
  }

  /** Tracking dropped out: forget the motion so far. */
  lose(): void {
    this.prev = null;
    this.active = null;
  }
}

export interface Calibration {
  hand: Hand;
  neutralTilt: number;
  neutralAcross: number;
  thresholds: [number, number];
}

export const DEFAULT_CALIBRATION: Calibration = {
  hand: "right",
  neutralTilt: 0,
  // a relaxed racket hand hangs about half a shoulder-width out to its side
  neutralAcross: -0.5,
  thresholds: DEFAULT_SWING.thresholds,
};

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Neutral tilt and hand position from frames captured while the player stands still. */
export function neutralFrom(samples: readonly { tilt: number; across: number }[]): { neutralTilt: number; neutralAcross: number } | null {
  if (samples.length < 5) return null;
  return { neutralTilt: median(samples.map((s) => s.tilt)), neutralAcross: median(samples.map((s) => s.across)) };
}

/**
 * Thresholds halfway between the player's light, medium and hard swings. Falls
 * back to the defaults when the three aren't clearly different.
 */
export function thresholdsFrom(peaks: { light: number[]; medium: number[]; hard: number[] }): [number, number] {
  if (!peaks.light.length || !peaks.medium.length || !peaks.hard.length) return DEFAULT_SWING.thresholds;
  const [l, m, h] = [median(peaks.light), median(peaks.medium), median(peaks.hard)];
  if (!(m > l * 1.15 && h > m * 1.15)) return DEFAULT_SWING.thresholds;
  return [(l + m) / 2, (m + h) / 2];
}

export interface CameraFrame {
  /** milliseconds */
  t: number;
  landmarks: readonly Point[] | null;
  /** video width / height */
  aspect: number;
}

export interface CameraOutput {
  tracking: boolean;
  /** Between swing start and contact: target and aim are frozen. */
  swinging: boolean;
  /** Movement target on screen, -1..1; null while not tracking. */
  target: number | null;
  /** Aim on screen, -1..1. */
  aim: number;
  swing: (SwingEvent & { aim: number }) | null;
}

// A swing's wind-up moves the hand a little before it is fast enough to count
// as a swing, so the frozen values come from this long before the start.
const FREEZE_LOOKBACK_MS = 100;

/**
 * Tilt, aim and swings from a stream of pose frames. From the start of a swing
 * to contact, the movement target and aim stay as they were just before the
 * swing began, so the swinging arm and the lean it causes can't move the
 * player or the shot.
 */
export class CameraController {
  private aimFilter = new OneEuro(1, 0.5);
  private tiltFilter = new OneEuro(1, 0.05);
  private detector: SwingDetector;
  private target: number | null = null;
  private aim = 0;
  private frozen: { target: number | null; aim: number } | null = null;
  private history: { t: number; target: number | null; aim: number }[] = [];
  private calib: Calibration;

  constructor(calib: Calibration, swing: SwingConfig = DEFAULT_SWING) {
    this.calib = calib;
    this.detector = new SwingDetector({ ...swing, thresholds: calib.thresholds }, calib.hand);
  }

  setCalibration(calib: Calibration): void {
    this.calib = calib;
    this.detector.cfg = { ...this.detector.cfg, thresholds: calib.thresholds };
    this.detector.hand = calib.hand;
  }

  update(f: CameraFrame): CameraOutput {
    const frame = f.landmarks ? bodyFrame(f.landmarks, f.aspect) : null;
    const w = frame && f.landmarks ? wrist(f.landmarks, frame, this.calib.hand, f.aspect) : null;
    if (!frame || !w) {
      this.detector.lose();
      this.frozen = null;
      this.history = [];
      return { tracking: false, swinging: false, target: null, aim: this.aim, swing: null };
    }

    const { started, swing } = this.detector.update(f.t, w);
    if (started) {
      const before = f.t - FREEZE_LOOKBACK_MS;
      this.frozen = this.history.findLast((h) => h.t <= before) ?? this.history[0] ?? null;
    }

    this.target = tiltToTarget(this.tiltFilter.filter(frame.tilt, f.t), this.calib.neutralTilt);
    this.aim = aimFromHand(this.aimFilter.filter(w.across, f.t), this.calib.neutralAcross);
    this.history.push({ t: f.t, target: this.target, aim: this.aim });
    if (this.history.length > 12) this.history.shift();

    const shown = this.frozen ? { target: this.frozen.target, aim: this.frozen.aim } : { target: this.target, aim: this.aim };
    if (swing) {
      this.frozen = null;
      return { tracking: true, swinging: false, ...shown, swing: { ...swing, aim: shown.aim } };
    }
    return { tracking: true, swinging: this.frozen !== null, ...shown, swing: null };
  }
}

/**
 * Decides when to send a movement target: when it has changed, at most every
 * `intervalMs` (the server accepts about 40 a second). The first target is
 * always sent.
 */
export class MoveThrottle {
  private last: { t: number; target: number } | null = null;
  private intervalMs: number;

  constructor(intervalMs = 40) {
    this.intervalMs = intervalMs;
  }

  /** The target to send now, or null to send nothing. */
  next(t: number, target: number | null): number | null {
    if (target === null) return null;
    if (this.last && (Math.abs(target - this.last.target) <= 0.01 || t - this.last.t < this.intervalMs)) return null;
    this.last = { t, target };
    return target;
  }

  reset(): void {
    this.last = null;
  }
}
