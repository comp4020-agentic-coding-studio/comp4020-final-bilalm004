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
export const LM = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftPinky: 17,
  rightPinky: 18,
  leftThumb: 21,
  rightThumb: 22,
} as const;

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
  /** Below the shoulder line in shoulder-widths (negative above it). */
  down: number;
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
  const d = downAxis(frame);
  return { across: pos.x * frame.across.x + pos.y * frame.across.y, down: pos.x * d.x + pos.y * d.y, pos };
}

/** Unit vector perpendicular to the shoulder line, pointing down the image. */
function downAxis(frame: BodyFrame): Vec {
  const u = frame.across;
  return u.x >= 0 ? { x: -u.y, y: u.x } : { x: u.y, y: -u.x };
}

export interface TiltConfig {
  deadZone: number;
  /** Tilt beyond neutral, in degrees, that reaches the sideline. */
  fullTilt: number;
}

// Wide enough that a natural sway doesn't move you (playtest: 9 degrees for
// the whole court was too twitchy).
export const DEFAULT_TILT: TiltConfig = { deadZone: 3, fullTilt: 16 };

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

/**
 * Which way the racket hand is turned: positive when the palm faces the camera
 * (forehand grip), negative when the back of the hand does (backhand grip),
 * null when it can't be read (hand hidden, or pointing straight at the camera).
 *
 * It is the sine of the angle from the forearm (elbow to wrist) to the line
 * from pinky to thumb, measured in the body's frame (across the shoulders and
 * down), so it holds with the arm up or down and in a mirrored image.
 */
export function palmFacing(lm: readonly Point[], frame: BodyFrame, hand: Hand, aspect: number): number | null {
  const right = hand === "right";
  const elbow = lm[right ? LM.rightElbow : LM.leftElbow];
  const wristP = lm[right ? LM.rightWrist : LM.leftWrist];
  const thumb = lm[right ? LM.rightThumb : LM.leftThumb];
  const pinky = lm[right ? LM.rightPinky : LM.leftPinky];
  if (!visible(elbow) || !visible(wristP) || !visible(thumb) || !visible(pinky)) return null;
  const u = frame.across;
  const d = downAxis(frame);
  const inBody = (a: Point, b: Point): Vec => {
    const A = scaled(a, aspect);
    const B = scaled(b, aspect);
    const v = { x: (B.x - A.x) / frame.width, y: (B.y - A.y) / frame.width };
    return { x: v.x * u.x + v.y * u.y, y: v.x * d.x + v.y * d.y };
  };
  const fore = inBody(elbow, wristP);
  const tp = inBody(pinky, thumb);
  const lf = Math.hypot(fore.x, fore.y);
  const lt = Math.hypot(tp.x, tp.y);
  if (lf < 0.15 || lt < 0.03) return null;
  const sin = (fore.x * tp.y - fore.y * tp.x) / (lf * lt);
  return right ? sin : -sin;
}

/** Forehand or backhand grip; an unclear reading keeps the previous grip. */
export function gripFrom(facing: number | null, prev: SwingKind, threshold = 0.3): SwingKind {
  if (facing === null || Math.abs(facing) < threshold) return prev;
  return facing > 0 ? "forehand" : "backhand";
}

/**
 * Aim for a grip. In a backhand stance the hand rests on the other side of the
 * body, so aim is measured from the calibrated neutral reflected across it.
 */
export function aimForGrip(across: number, neutral: number, grip: SwingKind): number {
  return aimFromHand(across, grip === "forehand" ? neutral : -neutral);
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

/** A swing as the wrist saw it. Forehand or backhand comes from the grip, not the motion. */
export interface SwingEvent {
  level: Level;
  peak: number;
  startedAt: number;
  at: number;
}

export class SwingDetector {
  private prev: { t: number; pos: Vec; across: number } | null = null;
  private active: { startedAt: number; peak: number } | null = null;
  private lastEnd = -Infinity;
  private lastLevel: Level | null = null;
  cfg: SwingConfig;

  constructor(cfg: SwingConfig) {
    this.cfg = cfg;
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
      this.active = { startedAt: prev.t, peak: speed };
      return { started: true, swing: null };
    }

    const a = this.active;
    if (speed > a.peak) a.peak = speed;
    // contact: the wrist has clearly slowed after its peak, or the swing ran too long
    if (speed < Math.max(this.cfg.start, a.peak * 0.6) || t - a.startedAt > this.cfg.maxMs) {
      this.active = null;
      this.lastEnd = t;
      const level = levelFromSpeed(a.peak, this.cfg.thresholds, this.lastLevel, this.cfg.hysteresis);
      this.lastLevel = level;
      return { started: false, swing: { level, peak: a.peak, startedAt: a.startedAt, at: t } };
    }
    return { started: false, swing: null };
  }

  /** Tracking dropped out: forget the motion so far. */
  lose(): void {
    this.prev = null;
    this.active = null;
  }
}

/**
 * How a camera swing becomes a shot.
 * - "follow": your character copies your arm, and the shot happens when your
 *   hand sweeps through the hitting line in front of you (ZoneDetector).
 * - "classic": a fast wrist movement is a swing, shown as a canned stroke
 *   (SwingDetector). Kept so we can switch back.
 */
export type SwingMode = "follow" | "classic";

/**
 * Where a camera shot goes. "point": where the racket hand pointed before the
 * swing. "timing": how early or late the ball is met (early pulls it across,
 * late pushes it down the line), worked out by the server.
 */
export type AimMode = "point" | "timing";

export interface Calibration {
  hand: Hand;
  mode: SwingMode;
  aim: AimMode;
  neutralTilt: number;
  neutralAcross: number;
  thresholds: [number, number];
}

export const DEFAULT_CALIBRATION: Calibration = {
  hand: "right",
  // user's choice after playtesting: classic swing, aim by timing
  mode: "classic",
  aim: "timing",
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

export interface ZoneConfig {
  /** Distance of the hitting line from the body's centre, toward the side the ball is met on, in shoulder-widths. */
  line: number;
  /** Slowest hand speed through the line that counts as a shot (shoulder-widths per second). */
  minSpeed: number;
  cooldownMs: number;
  /** Hand height (below the shoulders, shoulder-widths) that gives no extra lift, and the change that gives full lift. */
  liftAt: number;
  liftRange: number;
}

export const DEFAULT_ZONE: ZoneConfig = { line: 0.25, minSpeed: 2.5, cooldownMs: 300, liftAt: 1, liftRange: 0.8 };

export interface ZoneHit {
  level: Level;
  /** -1 (hand low: flatter) .. 1 (hand high: more loft) */
  lift: number;
  speed: number;
  /** when the hand crossed the line, interpolated between frames */
  at: number;
}

/**
 * The hit moment for "follow" mode: the racket hand sweeping through a line in
 * front of the body. A forehand meets the ball on the racket side, moving
 * toward the off-hand side; a backhand meets it on the off-hand side, moving
 * back toward the racket side. Taking the racket back crosses the line the
 * other way, so a wind-up never counts.
 */
export class ZoneDetector {
  private prev: { t: number; a: number; down: number; pos: Vec } | null = null;
  private lastHit = -Infinity;
  private lastLevel: Level | null = null;
  cfg: ZoneConfig;
  thresholds: [number, number];
  hysteresis: number;

  constructor(cfg: ZoneConfig, thresholds: [number, number], hysteresis = DEFAULT_SWING.hysteresis) {
    this.cfg = cfg;
    this.thresholds = thresholds;
    this.hysteresis = hysteresis;
  }

  update(t: number, w: Wrist, grip: SwingKind, hand: Hand): ZoneHit | null {
    // a: along the shoulder line, positive toward the off-hand side
    const a = hand === "right" ? w.across : -w.across;
    const prev = this.prev;
    this.prev = { t, a, down: w.down, pos: w.pos };
    if (!prev || t <= prev.t || t - this.lastHit < this.cfg.cooldownMs) return null;
    const line = grip === "forehand" ? -this.cfg.line : this.cfg.line;
    const crossed = grip === "forehand" ? prev.a < line && a >= line : prev.a > line && a <= line;
    if (!crossed) return null;
    const speed = Math.hypot(w.pos.x - prev.pos.x, w.pos.y - prev.pos.y) / ((t - prev.t) / 1000);
    if (speed < this.cfg.minSpeed) return null;
    const k = (line - prev.a) / (a - prev.a);
    const at = prev.t + k * (t - prev.t);
    const down = prev.down + k * (w.down - prev.down);
    this.lastHit = t;
    const level = levelFromSpeed(speed, this.thresholds, this.lastLevel, this.hysteresis);
    this.lastLevel = level;
    const lift = Math.max(-1, Math.min(1, (this.cfg.liftAt - down) / this.cfg.liftRange));
    return { level, lift, speed, at };
  }

  lose(): void {
    this.prev = null;
  }
}

export interface Vec3 {
  /** outward, away from the body on the racket side */
  out: number;
  up: number;
  /** toward the camera, which is toward the net for the player's character */
  fwd: number;
}

export interface ArmPose {
  /** unit direction shoulder to elbow */
  upper: Vec3;
  /** unit direction elbow to wrist */
  fore: Vec3;
}

// arm segments in shoulder-widths, for working out reach toward the camera
const UPPER_ARM = 0.8;
const FOREARM = 0.7;

/**
 * The racket arm's direction, for the character to copy. The camera only sees
 * the arm flattened onto the image, so each segment's reach toward the camera
 * is whatever its expected length doesn't show sideways or up and down.
 */
export function armPose(lm: readonly Point[], frame: BodyFrame, hand: Hand, aspect: number): ArmPose | null {
  const right = hand === "right";
  const sh = lm[right ? LM.rightShoulder : LM.leftShoulder];
  const el = lm[right ? LM.rightElbow : LM.leftElbow];
  const wr = lm[right ? LM.rightWrist : LM.leftWrist];
  if (!visible(sh) || !visible(el) || !visible(wr)) return null;
  const u = frame.across;
  const d = downAxis(frame);
  const segment = (a: Point, b: Point, length: number): Vec3 => {
    const A = scaled(a, aspect);
    const B = scaled(b, aspect);
    const v = { x: (B.x - A.x) / frame.width, y: (B.y - A.y) / frame.width };
    const across = v.x * u.x + v.y * u.y;
    const down = v.x * d.x + v.y * d.y;
    const out = right ? -across : across;
    const seen = Math.hypot(out, down);
    const fwd = Math.sqrt(Math.max(0, length * length - seen * seen));
    const n = Math.hypot(out, down, fwd) || 1;
    return { out: out / n, up: -down / n, fwd: fwd / n };
  };
  return { upper: segment(sh, el, UPPER_ARM), fore: segment(el, wr, FOREARM) };
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
  /** The grip being held: palm to the camera is forehand, back of the hand backhand. */
  grip: SwingKind;
  /** The racket arm's direction while tracking, for the character to copy. */
  arm: ArmPose | null;
  /** A shot: in classic mode from SwingDetector, in follow mode from ZoneDetector (with lift). */
  swing: { level: Level; kind: SwingKind; aim: number; lift?: number; at: number } | null;
}

// A swing's wind-up moves the hand a little before it is fast enough to count
// as a swing, so the frozen values come from this long before the start.
const FREEZE_LOOKBACK_MS = 100;

/**
 * Tilt, grip, aim and swings from a stream of pose frames. From the start of
 * a swing to contact, the movement target, grip and aim stay as they were just
 * before the swing began, so the swinging arm and the lean it causes can't
 * move the player or change the shot; the swing is the grip held then.
 */
export class CameraController {
  private aimFilter = new OneEuro(1, 0.5);
  private tiltFilter = new OneEuro(0.6, 0.02);
  private detector: SwingDetector;
  private zone: ZoneDetector;
  private target: number | null = null;
  private aim = 0;
  private grip: SwingKind = "forehand";
  private frozen: { target: number | null; aim: number; grip: SwingKind } | null = null;
  private history: { t: number; target: number | null; aim: number; grip: SwingKind }[] = [];
  private calib: Calibration;

  constructor(calib: Calibration, swing: SwingConfig = DEFAULT_SWING) {
    this.calib = calib;
    this.detector = new SwingDetector({ ...swing, thresholds: calib.thresholds });
    this.zone = new ZoneDetector({ ...DEFAULT_ZONE, minSpeed: swing.start }, calib.thresholds, swing.hysteresis);
  }

  setCalibration(calib: Calibration): void {
    this.calib = calib;
    this.detector.cfg = { ...this.detector.cfg, thresholds: calib.thresholds };
    this.zone.thresholds = calib.thresholds;
  }

  update(f: CameraFrame): CameraOutput {
    const frame = f.landmarks ? bodyFrame(f.landmarks, f.aspect) : null;
    const w = frame && f.landmarks ? wrist(f.landmarks, frame, this.calib.hand, f.aspect) : null;
    if (!frame || !w) {
      this.detector.lose();
      this.zone.lose();
      this.frozen = null;
      this.history = [];
      return { tracking: false, swinging: false, target: null, aim: this.aim, grip: this.grip, arm: null, swing: null };
    }

    // In both modes a fast hand starts the freeze. Classic: the swing is the
    // detector's. Follow: the swing is the hand crossing the hitting line with
    // the grip held before the swing began; the freeze ends there, or when
    // the motion dies out without crossing.
    const classic = this.detector.update(f.t, w);
    const started = classic.started;
    if (started) {
      const before = f.t - FREEZE_LOOKBACK_MS;
      this.frozen = this.history.findLast((h) => h.t <= before) ?? this.history[0] ?? null;
    }

    this.target = tiltToTarget(this.tiltFilter.filter(frame.tilt, f.t), this.calib.neutralTilt);
    this.grip = gripFrom(palmFacing(f.landmarks as readonly Point[], frame, this.calib.hand, f.aspect), this.grip);
    this.aim = aimForGrip(this.aimFilter.filter(w.across, f.t), this.calib.neutralAcross, this.grip);
    this.history.push({ t: f.t, target: this.target, aim: this.aim, grip: this.grip });
    if (this.history.length > 12) this.history.shift();

    const f0 = this.frozen;
    const shown = f0 ? { target: f0.target, aim: f0.aim, grip: f0.grip } : { target: this.target, aim: this.aim, grip: this.grip };
    const arm = armPose(f.landmarks as readonly Point[], frame, this.calib.hand, f.aspect);
    let swing: CameraOutput["swing"] = null;
    if (this.calib.mode === "classic") {
      if (classic.swing) swing = { level: classic.swing.level, kind: shown.grip, aim: shown.aim, at: classic.swing.at };
    } else {
      const hit = this.zone.update(f.t, w, shown.grip, this.calib.hand);
      if (hit) swing = { level: hit.level, kind: shown.grip, aim: shown.aim, lift: hit.lift, at: hit.at };
    }
    if (swing || classic.swing) this.frozen = null;
    return { tracking: true, swinging: !swing && f0 !== null, ...shown, arm, swing };
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

/**
 * The aim the reticle and arc should show, on screen (-1..1). Aiming by
 * timing, pointing doesn't steer the shot, so they show the on-time
 * (straight) shot. Without the camera tracking, keys/mouse/touch aim.
 */
export function shownAim(cameraAim: number | null, aimMode: AimMode, otherAim: number): number {
  if (cameraAim === null) return otherAim;
  return aimMode === "timing" ? 0 : cameraAim;
}
