import { describe, expect, it } from "vitest";
import {
  CameraController,
  DEFAULT_CALIBRATION,
  DEFAULT_SWING,
  LM,
  MoveThrottle,
  OneEuro,
  SwingDetector,
  aimFromHand,
  bodyFrame,
  classifyKind,
  levelFromSpeed,
  neutralFrom,
  thresholdsFrom,
  tiltToTarget,
  wrist,
} from "../client/input/camera/pose.ts";
import type { CameraOutput, Point } from "../client/input/camera/pose.ts";
import type { Hand } from "../shared/games/tennis/sim.ts";

const ASPECT = 4 / 3;

interface Pose {
  /** lean to the player's right, degrees */
  tilt?: number;
  /** racket wrist along the shoulder line (toward the player's left), shoulder-widths */
  across?: number;
  /** racket wrist below the shoulder line, shoulder-widths */
  down?: number;
  hand?: Hand;
  /** a selfie-style mirrored image */
  mirrored?: boolean;
  /** shoulder width in image heights: how close to the camera */
  width?: number;
}

/** 33 landmarks for a player with the given lean and racket-hand position. */
function pose({ tilt = 0, across = -0.5, down = 0.3, hand = "right", mirrored = false, width = 0.25 }: Pose = {}): Point[] {
  const th = (tilt * Math.PI) / 180;
  const m = mirrored ? -1 : 1;
  // unmirrored, the player's left shoulder is on the image's right
  const u = { x: m * Math.cos(th), y: -Math.sin(th) };
  const n = { x: m * Math.sin(th), y: Math.cos(th) };
  const mid = { x: 0.5 * ASPECT, y: 0.4 };
  const at = (a: number, d: number): Point => ({
    x: (mid.x + (a * u.x + d * n.x) * width) / ASPECT,
    y: mid.y + (a * u.y + d * n.y) * width,
    visibility: 0.99,
  });
  const lm: Point[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.99 }));
  lm[LM.leftShoulder] = at(0.5, 0);
  lm[LM.rightShoulder] = at(-0.5, 0);
  lm[hand === "right" ? LM.rightWrist : LM.leftWrist] = at(across, down);
  lm[hand === "right" ? LM.leftWrist : LM.rightWrist] = at(hand === "right" ? 0.5 : -0.5, 1.2);
  return lm;
}

/** A swing sampled at 30 fps: the wrist moves `distance` shoulder-widths across the body in `ms`. */
function swingFrames(t0: number, opts: { from: number; distance: number; ms: number; tilt?: number; hand?: Hand }) {
  const frames: { t: number; lm: Point[] }[] = [];
  const steps = Math.round(opts.ms / 33);
  for (let i = 0; i <= steps; i++) {
    // fast in the middle, like a real swing: smoothstep position
    const p = i / steps;
    const s = p * p * (3 - 2 * p);
    frames.push({ t: t0 + i * 33, lm: pose({ across: opts.from + s * opts.distance, tilt: opts.tilt, hand: opts.hand }) });
  }
  // follow-through: the hand stops
  for (let i = 1; i <= 6; i++) {
    frames.push({ t: t0 + (steps + i) * 33, lm: pose({ across: opts.from + opts.distance, tilt: opts.tilt, hand: opts.hand }) });
  }
  return frames;
}

describe("body frame", () => {
  it("reads the lean in degrees, positive to the player's right, mirrored or not", () => {
    for (const mirrored of [false, true]) {
      expect(bodyFrame(pose({ tilt: 6, mirrored }), ASPECT)!.tilt).toBeCloseTo(6, 6);
      expect(bodyFrame(pose({ tilt: -4, mirrored }), ASPECT)!.tilt).toBeCloseTo(-4, 6);
    }
  });

  it("measures the wrist in shoulder-widths along the shoulder line, whatever the distance or lean", () => {
    for (const width of [0.15, 0.4]) {
      for (const tilt of [0, 8]) {
        for (const mirrored of [false, true]) {
          const lm = pose({ across: 0.7, width, tilt, mirrored });
          expect(wrist(lm, bodyFrame(lm, ASPECT)!, "right", ASPECT)!.across).toBeCloseTo(0.7, 6);
        }
      }
    }
  });

  it("has no frame when a shoulder isn't visible", () => {
    const lm = pose();
    lm[LM.leftShoulder] = { ...lm[LM.leftShoulder], visibility: 0.1 };
    expect(bodyFrame(lm, ASPECT)).toBeNull();
  });
});

describe("tilt to movement", () => {
  it("ignores small leans, then covers the court within about 9 degrees", () => {
    expect(tiltToTarget(1, 0)).toBe(0);
    expect(tiltToTarget(5, 0)).toBeGreaterThan(0.3);
    expect(tiltToTarget(9, 0)).toBe(1);
    expect(tiltToTarget(-20, 0)).toBe(-1);
  });

  it("is measured from the calibrated neutral", () => {
    expect(tiltToTarget(4, 4)).toBe(0);
    expect(tiltToTarget(13, 4)).toBe(1);
  });
});

describe("aim", () => {
  it("points right on screen when the hand moves to the player's right", () => {
    expect(aimFromHand(-0.5, -0.5)).toBe(0);
    expect(aimFromHand(-0.9, -0.5)).toBeGreaterThan(0);
    expect(aimFromHand(-0.1, -0.5)).toBeLessThan(0);
    expect(aimFromHand(-5, -0.5)).toBe(1);
  });

  it("does not change when the player leans but keeps the hand still against the shoulders", () => {
    const c = new CameraController(DEFAULT_CALIBRATION);
    let upright: CameraOutput | null = null;
    for (let t = 0; t < 1000; t += 33) upright = c.update({ t, landmarks: pose({ across: -0.8 }), aspect: ASPECT });
    let leaning: CameraOutput | null = null;
    for (let t = 1000; t < 2000; t += 33) leaning = c.update({ t, landmarks: pose({ across: -0.8, tilt: 8 }), aspect: ASPECT });
    expect(leaning!.aim).toBeCloseTo(upright!.aim, 6);
    expect(leaning!.target).toBeGreaterThan(0.5);
  });
});

describe("One Euro filter", () => {
  it("smooths jitter while still and catches up after a move", () => {
    const f = new OneEuro(1, 0.5);
    let out = 0;
    for (let i = 0; i < 60; i++) out = f.filter(i % 2 ? 0.05 : -0.05, i * 33);
    expect(Math.abs(out)).toBeLessThan(0.03);
    for (let i = 60; i < 120; i++) out = f.filter(1, i * 33);
    expect(out).toBeGreaterThan(0.95);
  });
});

describe("swing levels", () => {
  const [t1, t2] = DEFAULT_SWING.thresholds;

  it("splits peak speed at the two thresholds", () => {
    expect(levelFromSpeed(t1 * 0.8, [t1, t2], null, 0.1)).toBe(0);
    expect(levelFromSpeed((t1 + t2) / 2, [t1, t2], null, 0.1)).toBe(1);
    expect(levelFromSpeed(t2 * 1.2, [t1, t2], null, 0.1)).toBe(2);
  });

  it("keeps the last level for a peak just across a threshold (hysteresis)", () => {
    expect(levelFromSpeed(t1 * 1.05, [t1, t2], 0, 0.1)).toBe(0);
    expect(levelFromSpeed(t1 * 1.15, [t1, t2], 0, 0.1)).toBe(1);
    expect(levelFromSpeed(t2 * 0.95, [t1, t2], 2, 0.1)).toBe(2);
    expect(levelFromSpeed(t2 * 0.85, [t1, t2], 2, 0.1)).toBe(1);
  });

  it("detects soft, medium and hard swings from wrist speed", () => {
    const levels = [
      { distance: 0.6, ms: 300 },
      { distance: 1.2, ms: 300 },
      { distance: 2.2, ms: 300 },
    ].map(({ distance, ms }) => {
      const d = new SwingDetector(DEFAULT_SWING, "right");
      const events = swingFrames(0, { from: -0.8, distance, ms }).map((f) => {
        const lm = f.lm;
        return d.update(f.t, wrist(lm, bodyFrame(lm, ASPECT)!, "right", ASPECT)!).swing;
      });
      const swings = events.filter((e) => e !== null);
      expect(swings).toHaveLength(1);
      return swings[0]!.level;
    });
    expect(levels).toEqual([0, 1, 2]);
  });

  it("ignores a slow hand movement and waits out the cooldown between swings", () => {
    const d = new SwingDetector(DEFAULT_SWING, "right");
    const feed = (frames: { t: number; lm: Point[] }[]) =>
      frames.map((f) => d.update(f.t, wrist(f.lm, bodyFrame(f.lm, ASPECT)!, "right", ASPECT)!).swing).filter((e) => e !== null);
    expect(feed(swingFrames(0, { from: -0.8, distance: 0.3, ms: 600 }))).toHaveLength(0);
    expect(feed(swingFrames(2000, { from: -0.8, distance: 1.5, ms: 300 }))).toHaveLength(1);
    // straight back the other way inside the cooldown
    expect(feed(swingFrames(2000 + 16 * 33, { from: 0.7, distance: -1.5, ms: 300 })).length).toBeLessThanOrEqual(1);
  });
});

describe("forehand and backhand", () => {
  it("crossing toward the off-hand side is a forehand, moving back out is a backhand", () => {
    expect(classifyKind(1, "right")).toBe("forehand");
    expect(classifyKind(-1, "right")).toBe("backhand");
    expect(classifyKind(-1, "left")).toBe("forehand");
    expect(classifyKind(1, "left")).toBe("backhand");
  });

  it("classifies whole swings for both hands", () => {
    const kindOf = (hand: Hand, from: number, distance: number) => {
      const d = new SwingDetector(DEFAULT_SWING, hand);
      for (const f of swingFrames(0, { from, distance, ms: 300, hand })) {
        const s = d.update(f.t, wrist(f.lm, bodyFrame(f.lm, ASPECT)!, hand, ASPECT)!).swing;
        if (s) return s.kind;
      }
      return null;
    };
    expect(kindOf("right", -0.8, 1.5)).toBe("forehand");
    expect(kindOf("right", 0.7, -1.5)).toBe("backhand");
    expect(kindOf("left", 0.8, -1.5)).toBe("forehand");
    expect(kindOf("left", -0.7, 1.5)).toBe("backhand");
  });
});

describe("camera controller", () => {
  it("holds aim and movement target from swing start to contact, then sends the aim from before the swing", () => {
    const c = new CameraController(DEFAULT_CALIBRATION);
    let last: CameraOutput | null = null;
    for (let t = 0; t < 1000; t += 33) last = c.update({ t, landmarks: pose({ across: -0.9, tilt: 4 }), aspect: ASPECT });
    const settled = { aim: last!.aim, target: last!.target };
    expect(settled.aim).toBeGreaterThan(0.3);

    // the swing drags the hand across the body and the shoulders with it
    const during: CameraOutput[] = [];
    for (let i = 0; i <= 15; i++) {
      const p = Math.min(1, i / 9);
      const lm = pose({ across: -0.9 + p * p * (3 - 2 * p) * 1.8, tilt: 4 - i });
      const out = c.update({ t: 1000 + i * 33, landmarks: lm, aspect: ASPECT });
      during.push(out);
      if (out.swing) break;
    }
    const contact = during.at(-1)!;
    expect(contact.swing).not.toBeNull();
    const fromStart = during.filter((out) => out.swinging || out.swing);
    expect(fromStart.length).toBeGreaterThan(2);
    for (const out of fromStart) {
      expect(out.aim).toBeCloseTo(settled.aim, 2);
      expect(out.target).toBeCloseTo(settled.target!, 2);
    }
    expect(contact.swing!.aim).toBeCloseTo(settled.aim, 2);
    expect(contact.swing!.kind).toBe("forehand");
  });

  it("reports lost tracking and recovers", () => {
    const c = new CameraController(DEFAULT_CALIBRATION);
    expect(c.update({ t: 0, landmarks: null, aspect: ASPECT }).tracking).toBe(false);
    expect(c.update({ t: 33, landmarks: pose(), aspect: ASPECT }).tracking).toBe(true);
  });
});

describe("calibration", () => {
  it("takes the neutral from the median of still frames", () => {
    const samples = [1, 2, 2, 3, 40].map((tilt) => ({ tilt, across: -0.5 }));
    expect(neutralFrom(samples)).toEqual({ neutralTilt: 2, neutralAcross: -0.5 });
    expect(neutralFrom(samples.slice(0, 2))).toBeNull();
  });

  it("puts thresholds between the player's own swings, or keeps the defaults if they overlap", () => {
    expect(thresholdsFrom({ light: [3, 4], medium: [7], hard: [12, 13, 14] })).toEqual([5.25, 10]);
    expect(thresholdsFrom({ light: [6], medium: [6.2], hard: [12] })).toEqual(DEFAULT_SWING.thresholds);
    expect(thresholdsFrom({ light: [], medium: [6], hard: [12] })).toEqual(DEFAULT_SWING.thresholds);
  });
});

describe("move throttle", () => {
  // Regression: the camera used to never send a move, because the first
  // comparison was against NaN.
  it("sends the first target straight away", () => {
    expect(new MoveThrottle().next(0, 0.4)).toBe(0.4);
  });

  it("sends changes at most every interval, skips repeats and lost tracking", () => {
    const m = new MoveThrottle(40);
    expect(m.next(0, 0)).toBe(0);
    expect(m.next(20, 0.5)).toBeNull();
    expect(m.next(40, 0.5)).toBe(0.5);
    expect(m.next(100, 0.505)).toBeNull();
    expect(m.next(140, null)).toBeNull();
    expect(m.next(180, -1)).toBe(-1);
  });

  it("leaning drives a stream of moves from the camera controller", () => {
    const c = new CameraController(DEFAULT_CALIBRATION);
    const m = new MoveThrottle();
    const sent: number[] = [];
    for (let i = 0; i < 60; i++) {
      const out = c.update({ t: i * 33, landmarks: pose({ tilt: i < 20 ? 0 : 9 }), aspect: ASPECT });
      const target = m.next(i * 33, out.target);
      if (target !== null) sent.push(target);
    }
    expect(sent[0]).toBe(0);
    expect(sent.at(-1)).toBeGreaterThan(0.9);
  });
});
