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
  aimForGrip,
  DEFAULT_ZONE,
  ZoneDetector,
  armPose,
  bodyFrame,
  gripFrom,
  levelFromSpeed,
  neutralFrom,
  palmFacing,
  thresholdsFrom,
  tiltToTarget,
  wrist,
} from "../client/input/camera/pose.ts";
import type { CameraOutput, Point, Wrist } from "../client/input/camera/pose.ts";
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
  /** palm to the camera (forehand), back of the hand (backhand), or a hidden hand */
  grip?: "forehand" | "backhand" | "hidden";
  /** forearm pointing up (hand raised) or down (arm hanging) */
  arm?: "up" | "down";
  /** put the racket elbow here instead: [across, down] in shoulder-widths */
  elbow?: [number, number];
}

/** 33 landmarks for a player with the given lean and racket-hand position. */
function pose({
  tilt = 0,
  across = -0.5,
  down = 0.3,
  hand = "right",
  mirrored = false,
  width = 0.25,
  grip = "forehand",
  arm = "up",
  elbow,
}: Pose = {}): Point[] {
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
  // forearm in the body frame (across, down), then the pinky-to-thumb line
  // turned 90 degrees from it: one way for palm-to-camera, the other for back
  const f = arm === "up" ? { a: 0, d: -1 } : { a: 0, d: 1 };
  const palm = (grip === "backhand" ? -1 : 1) * (hand === "right" ? 1 : -1);
  const tp = { a: -f.d * palm * 0.15, d: f.a * palm * 0.15 };
  const right = hand === "right";
  lm[right ? LM.rightElbow : LM.leftElbow] = at(across - f.a * 0.6, down - f.d * 0.6);
  const knuckles = { a: across + f.a * 0.15, d: down + f.d * 0.15 };
  lm[right ? LM.rightThumb : LM.leftThumb] = at(knuckles.a + tp.a / 2, knuckles.d + tp.d / 2);
  lm[right ? LM.rightPinky : LM.leftPinky] = at(knuckles.a - tp.a / 2, knuckles.d - tp.d / 2);
  if (elbow) lm[right ? LM.rightElbow : LM.leftElbow] = at(elbow[0], elbow[1]);
  if (grip === "hidden") {
    lm[right ? LM.rightThumb : LM.leftThumb].visibility = 0.1;
  }
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
  // Playtest: 9 degrees for the whole court was too quick.
  it("ignores a natural sway of up to 3 degrees, then takes about 16 degrees to cover the court", () => {
    expect(tiltToTarget(3, 0)).toBe(0);
    expect(tiltToTarget(-3, 0)).toBe(0);
    expect(tiltToTarget(6, 0)).toBeLessThan(0.3);
    expect(tiltToTarget(9, 0)).toBeLessThan(0.5);
    expect(tiltToTarget(16, 0)).toBe(1);
    expect(tiltToTarget(-30, 0)).toBe(-1);
  });

  it("is measured from the calibrated neutral", () => {
    expect(tiltToTarget(4, 4)).toBe(0);
    expect(tiltToTarget(20, 4)).toBe(1);
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
    for (let t = 1000; t < 2000; t += 33) leaning = c.update({ t, landmarks: pose({ across: -0.8, tilt: 14 }), aspect: ASPECT });
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
      const d = new SwingDetector(DEFAULT_SWING);
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
    const d = new SwingDetector(DEFAULT_SWING);
    const feed = (frames: { t: number; lm: Point[] }[]) =>
      frames.map((f) => d.update(f.t, wrist(f.lm, bodyFrame(f.lm, ASPECT)!, "right", ASPECT)!).swing).filter((e) => e !== null);
    expect(feed(swingFrames(0, { from: -0.8, distance: 0.3, ms: 600 }))).toHaveLength(0);
    expect(feed(swingFrames(2000, { from: -0.8, distance: 1.5, ms: 300 }))).toHaveLength(1);
    // straight back the other way inside the cooldown
    expect(feed(swingFrames(2000 + 16 * 33, { from: 0.7, distance: -1.5, ms: 300 })).length).toBeLessThanOrEqual(1);
  });
});

describe("grip: forehand or backhand", () => {
  const read = (p: Pose) => {
    const lm = pose(p);
    return palmFacing(lm, bodyFrame(lm, ASPECT)!, p.hand ?? "right", ASPECT);
  };

  it("palm to the camera is a forehand grip, back of the hand a backhand", () => {
    expect(read({ grip: "forehand" })!).toBeGreaterThan(0.9);
    expect(read({ grip: "backhand" })!).toBeLessThan(-0.9);
  });

  it("reads the same with the arm up or down, mirrored or not, leaning or not, for either hand", () => {
    for (const hand of ["right", "left"] as const) {
      for (const arm of ["up", "down"] as const) {
        for (const mirrored of [false, true]) {
          for (const tilt of [0, 10]) {
            expect(read({ hand, arm, mirrored, tilt, grip: "forehand", across: hand === "right" ? -0.5 : 0.5 })!).toBeGreaterThan(0.9);
            expect(read({ hand, arm, mirrored, tilt, grip: "backhand", across: hand === "right" ? 0.5 : -0.5 })!).toBeLessThan(-0.9);
          }
        }
      }
    }
  });

  it("can't read a hidden hand, and an unclear reading keeps the last grip", () => {
    expect(read({ grip: "hidden" })).toBeNull();
    expect(gripFrom(null, "backhand")).toBe("backhand");
    expect(gripFrom(0.1, "backhand")).toBe("backhand");
    expect(gripFrom(0.8, "backhand")).toBe("forehand");
    expect(gripFrom(-0.8, "forehand")).toBe("backhand");
  });

  it("measures backhand aim from the neutral reflected across the body", () => {
    // neutral forehand hand at -0.5: the mirror image, +0.5, aims straight in a backhand stance
    expect(aimForGrip(-0.5, -0.5, "forehand")).toBe(0);
    expect(aimForGrip(0.5, -0.5, "backhand")).toBe(0);
    expect(aimForGrip(0.9, -0.5, "backhand")).toBeLessThan(0);
    expect(aimForGrip(0.1, -0.5, "backhand")).toBeGreaterThan(0);
  });
});

describe("camera controller", () => {
  it.each(["follow", "classic"] as const)("holds aim and movement target from swing start to contact, then sends the aim from before the swing (%s)", (mode) => {
    const c = new CameraController({ ...DEFAULT_CALIBRATION, mode });
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

  it.each(["follow", "classic"] as const)("swings with the grip held when the swing started, even if the hand turns mid-swing (%s)", (mode) => {
    for (const grip of ["forehand", "backhand"] as const) {
      const c = new CameraController({ ...DEFAULT_CALIBRATION, mode });
      const rest = grip === "forehand" ? -0.5 : 0.5;
      let out: CameraOutput | null = null;
      for (let t = 0; t < 600; t += 33) out = c.update({ t, landmarks: pose({ across: rest, grip }), aspect: ASPECT });
      expect(out!.grip).toBe(grip);
      expect(out!.aim).toBeCloseTo(0, 1);

      let swing: CameraOutput["swing"] = null;
      for (let i = 0; i <= 15 && !swing; i++) {
        const p = Math.min(1, i / 9);
        const across = rest - Math.sign(rest) * p * p * (3 - 2 * p) * 1.6;
        // the wrist rolls over during the swing
        const turned = i > 3 ? (grip === "forehand" ? "backhand" : "forehand") : grip;
        swing = c.update({ t: 600 + i * 33, landmarks: pose({ across, grip: turned }), aspect: ASPECT }).swing;
      }
      expect(swing).not.toBeNull();
      expect(swing!.kind).toBe(grip);
    }
  });

  it("follow mode sends the hand height as lift and copies the arm; classic sends no lift", () => {
    const sweep = (mode: "follow" | "classic", down: number) => {
      const c = new CameraController({ ...DEFAULT_CALIBRATION, mode });
      let out: CameraOutput | null = null;
      for (let t = 0; t < 400; t += 33) out = c.update({ t, landmarks: pose({ across: -0.9, down }), aspect: ASPECT });
      expect(out!.arm).not.toBeNull();
      for (let i = 0; i <= 15; i++) {
        const p = Math.min(1, i / 9);
        out = c.update({ t: 400 + i * 33, landmarks: pose({ across: -0.9 + p * p * (3 - 2 * p) * 1.8, down }), aspect: ASPECT });
        if (out.swing) return out.swing;
      }
      return null;
    };
    expect(sweep("follow", 0.1)!.lift).toBe(1);
    expect(sweep("follow", 1.9)!.lift).toBe(-1);
    expect(sweep("classic", 0.3)!.lift).toBeUndefined();
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
      const out = c.update({ t: i * 33, landmarks: pose({ tilt: i < 20 ? 0 : 18 }), aspect: ASPECT });
      const target = m.next(i * 33, out.target);
      if (target !== null) sent.push(target);
    }
    expect(sent[0]).toBe(0);
    expect(sent.at(-1)).toBeGreaterThan(0.9);
  });
});

describe("follow mode: hitting line", () => {
  const W = (across: number, down = 1): Wrist => ({ across, down, pos: { x: across, y: down } });
  /** Feeds a hand moving from `from` to `to` in `ms`, 30 fps; returns the hits. */
  const sweep = (d: ZoneDetector, from: number, to: number, ms: number, grip: "forehand" | "backhand", hand: Hand = "right", t0 = 0, down = 1) => {
    const hits = [];
    const n = Math.round(ms / 33);
    for (let i = 0; i <= n; i++) {
      const hit = d.update(t0 + i * 33, W(from + ((to - from) * i) / n, down), grip, hand);
      if (hit) hits.push(hit);
    }
    return hits;
  };
  const make = () => new ZoneDetector(DEFAULT_ZONE, DEFAULT_SWING.thresholds);

  it("a forehand hits once as the hand crosses the line on the racket side, at the crossing time", () => {
    const hits = sweep(make(), -0.9, 0.9, 330, "forehand");
    expect(hits).toHaveLength(1);
    // -0.25 is 0.65/1.8 of the way, of 330 ms
    expect(hits[0].at).toBeCloseTo((0.65 / 1.8) * 330, 0);
  });

  it("taking the racket back crosses the other way and never counts", () => {
    expect(sweep(make(), 0.2, -1.2, 300, "forehand")).toHaveLength(0);
    expect(sweep(make(), -0.2, 1.2, 300, "backhand")).toHaveLength(0);
  });

  it("a backhand hits moving back out toward the racket side, on the off-hand side", () => {
    expect(sweep(make(), 0.9, -0.9, 330, "backhand")).toHaveLength(1);
  });

  it("works for a left-hander, mirrored", () => {
    expect(sweep(make(), 0.9, -0.9, 330, "forehand", "left")).toHaveLength(1);
    expect(sweep(make(), -0.9, 0.9, 330, "forehand", "left")).toHaveLength(0);
  });

  it("ignores a slow pass and a second crossing inside the cooldown", () => {
    expect(sweep(make(), -0.9, 0.9, 2000, "forehand")).toHaveLength(0);
    const d = make();
    expect(sweep(d, -0.9, 0.9, 200, "forehand")).toHaveLength(1);
    expect(sweep(d, -0.9, 0.9, 100, "forehand", "right", 230)).toHaveLength(0);
  });

  it("speed through the line sets the level, hand height the lift", () => {
    expect(sweep(make(), -0.9, 0.9, 500, "forehand")[0].level).toBe(0);
    expect(sweep(make(), -0.9, 0.9, 140, "forehand")[0].level).toBe(2);
    expect(sweep(make(), -0.9, 0.9, 330, "forehand", "right", 0, DEFAULT_ZONE.liftAt)[0].lift).toBeCloseTo(0, 6);
    expect(sweep(make(), -0.9, 0.9, 330, "forehand", "right", 0, 0)[0].lift).toBe(1);
    expect(sweep(make(), -0.9, 0.9, 330, "forehand", "right", 0, 2)[0].lift).toBe(-1);
  });
});

describe("follow mode: copying the arm", () => {
  const read = (p: Pose) => {
    const lm = pose(p);
    return armPose(lm, bodyFrame(lm, ASPECT)!, p.hand ?? "right", ASPECT);
  };

  it("an arm hanging down points down", () => {
    const a = read({ elbow: [-0.5, 0.8], across: -0.5, down: 1.5 })!;
    expect(a.upper.up).toBeCloseTo(-1, 2);
    expect(a.fore.up).toBeCloseTo(-1, 2);
  });

  it("an arm held out to the side points outward", () => {
    const a = read({ elbow: [-1.3, 0], across: -2, down: 0 })!;
    expect(a.upper.out).toBeCloseTo(1, 2);
    expect(a.fore.out).toBeCloseTo(1, 2);
  });

  it("an arm reaching toward the camera, which looks short in the picture, points forward", () => {
    const a = read({ elbow: [-0.5, 0.1], across: -0.5, down: 0.15 })!;
    expect(a.upper.fwd).toBeGreaterThan(0.95);
    expect(a.fore.fwd).toBeGreaterThan(0.95);
  });

  it("reads the same mirrored or leaning, and outward is the racket side for either hand", () => {
    const base = read({ elbow: [-1.0, 0.4], across: -1.2, down: 1.0 })!;
    for (const variant of [{ mirrored: true }, { tilt: 8 }]) {
      const v = read({ elbow: [-1.0, 0.4], across: -1.2, down: 1.0, ...variant })!;
      expect(v.upper.out).toBeCloseTo(base.upper.out, 6);
      expect(v.upper.up).toBeCloseTo(base.upper.up, 6);
      expect(v.fore.fwd).toBeCloseTo(base.fore.fwd, 6);
    }
    const lefty = read({ hand: "left", elbow: [1.0, 0.4], across: 1.2, down: 1.0 })!;
    expect(lefty.upper.out).toBeCloseTo(base.upper.out, 6);
  });

  it("can't copy an arm whose elbow is hidden", () => {
    const lm = pose();
    lm[LM.rightElbow] = { ...lm[LM.rightElbow], visibility: 0.1 };
    expect(armPose(lm, bodyFrame(lm, ASPECT)!, "right", ASPECT)).toBeNull();
  });
});
