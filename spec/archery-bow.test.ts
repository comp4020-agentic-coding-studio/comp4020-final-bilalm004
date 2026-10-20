// The bow-hold camera gesture (task 22): aim with the bow hand, draw with the
// other, a fast snap releases and a slow return lets the draw down.
import { describe, expect, it } from "vitest";
import { BowTracker, DEFAULT_BOW, HAND_HOLD_MS, drawHandOpenness, handOpenness, readBow } from "../client/games/archery/bow.ts";
import type { BowEvent } from "../client/games/archery/bow.ts";
import { LM } from "../client/input/camera/pose.ts";
import type { Point } from "../client/input/camera/pose.ts";
import { AIM, MIN_DRAW } from "../shared/games/archery/sim.ts";

const ASPECT = 16 / 9;
const W = 0.2; // shoulder width, image heights

/**
 * Landmarks for a player facing the camera, shoulders level at y 0.4. Hand
 * positions are [across, down] in shoulder-widths from the shoulder midpoint,
 * across positive toward the player's own left. The image is a selfie view:
 * the player's left is image right.
 */
function body(bow: [number, number], pull: [number, number], bowHand: "left" | "right" = "left"): Point[] {
  const lm: Point[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
  const at = ([across, down]: [number, number]): Point => ({ x: (0.5 * ASPECT + across * W) / ASPECT, y: 0.4 + down * W, visibility: 1 });
  lm[LM.leftShoulder] = at([0.5, 0]);
  lm[LM.rightShoulder] = at([-0.5, 0]);
  lm[bowHand === "left" ? LM.leftWrist : LM.rightWrist] = at(bow);
  lm[bowHand === "left" ? LM.rightWrist : LM.leftWrist] = at(pull);
  return lm;
}

const REST: [number, number] = [DEFAULT_BOW.restAcross, DEFAULT_BOW.restDown];

describe("reading the bow", () => {
  it("raising or lowering the aiming hand doesn't change the draw (playtest)", () => {
    const pull: [number, number] = [-1, 0.3];
    const level = readBow(body(REST, pull), ASPECT, "left")!.draw;
    expect(readBow(body([0, -0.5], pull), ASPECT, "left")!.draw).toBeCloseTo(level, 5);
    expect(readBow(body([0, 0.9], pull), ASPECT, "left")!.draw).toBeCloseTo(level, 5);
  });

  it("hands together is no draw; pulled a full span apart is a full draw", () => {
    expect(readBow(body(REST, [0, 0.4]), ASPECT, "left")!.draw).toBe(0);
    const full = readBow(body(REST, [-DEFAULT_BOW.fullSpan, DEFAULT_BOW.restDown]), ASPECT, "left")!;
    expect(full.draw).toBeCloseTo(1, 5);
    const half = readBow(body(REST, [-(DEFAULT_BOW.restSpan + DEFAULT_BOW.fullSpan) / 2, DEFAULT_BOW.restDown]), ASPECT, "left")!;
    expect(half.draw).toBeCloseTo(0.5, 5);
  });

  it("the bow hand at rest aims straight; moving it to your left aims left, up aims up", () => {
    const pull: [number, number] = [-1, 0.3];
    const straight = readBow(body(REST, pull), ASPECT, "left")!;
    expect(straight.yaw).toBeCloseTo(0, 5);
    expect(straight.pitch).toBeCloseTo(0, 5);
    expect(readBow(body([0.4, 0.3], pull), ASPECT, "left")!.yaw).toBeLessThan(0);
    expect(readBow(body([-0.4, 0.3], pull), ASPECT, "left")!.yaw).toBeGreaterThan(0);
    expect(readBow(body([0, -0.3], pull), ASPECT, "left")!.pitch).toBeGreaterThan(0);
    // pinned at the sim's limits however far the hand goes
    const far = readBow(body([-5, -5], pull), ASPECT, "left")!;
    expect(far.yaw).toBeCloseTo(AIM.yaw, 5);
    expect(far.pitch).toBeCloseTo(AIM.pitchMax, 5);
  });

  it("works with the bow in either hand", () => {
    const r = readBow(body([0.4, 0.3], [1.9, 0.3], "right"), ASPECT, "right")!;
    expect(r.yaw).toBeLessThan(0);
    expect(r.draw).toBeGreaterThan(0.5);
  });

  it("no shoulders or no hand: no reading", () => {
    const lm = body(REST, [-1, 0.3]);
    lm[LM.rightWrist] = { x: 0, y: 0, visibility: 0 };
    expect(readBow(lm, ASPECT, "left")).toBeNull();
  });
});

/** Feeds draws over time at 30 fps; returns every event. */
function feed(tracker: BowTracker, draws: number[], start = 0): BowEvent[] {
  return draws.map((draw, i) => tracker.update({ yaw: 0.1, pitch: 0.05, draw }, start + i * 33)).filter((e): e is BowEvent => e !== null);
}

const ramp = (from: number, to: number, n: number) => Array.from({ length: n }, (_, i) => from + ((to - from) * (i + 1)) / n);

describe("drawing and letting go", () => {
  it("a draw then a fast snap shoots with the draw held before the snap", () => {
    const t = new BowTracker();
    const events = feed(t, [...ramp(0, 0.9, 20), 0.9, 0.9, 0.9, 0.4, 0.05]);
    const release = events.find((e) => e.t === "release");
    expect(release).toBeDefined();
    expect(release!.t === "release" && release!.draw).toBeCloseTo(0.9, 5);
    expect(events.filter((e) => e.t === "release")).toHaveLength(1);
  });

  it("bringing the hand back slowly lets the draw down: no arrow", () => {
    const t = new BowTracker();
    const events = feed(t, [...ramp(0, 0.8, 15), ...ramp(0.8, 0, 40)]);
    expect(events.some((e) => e.t === "release")).toBe(false);
    expect(events).toContainEqual({ t: "letdown" });
  });

  it("a twitch below the minimum draw is never a shot", () => {
    const t = new BowTracker();
    const events = feed(t, [0, MIN_DRAW * 0.6, 0]);
    expect(events.some((e) => e.t === "release")).toBe(false);
  });

  it("losing sight of the hands mid-draw lets it down", () => {
    const t = new BowTracker();
    feed(t, ramp(0, 0.7, 10));
    expect(t.update(null, 1000)).toEqual({ t: "letdown" });
    expect(t.update(null, 1033)).toBeNull();
  });

  it("aims while drawing, with the sight smoothed", () => {
    const t = new BowTracker();
    const events = feed(t, ramp(0, 0.5, 5));
    expect(events.every((e) => e.t === "aim")).toBe(true);
  });
});

/**
 * A 21-point hand (MediaPipe's) with its wrist at (x, y) in normalised image
 * units, palm `palm` long pointing up. `open` 1 is fingers straight on from
 * the palm, 0 is folded right back (a fist). `facing`: the hand points at
 * the camera, so the palm and fingers run along z (depth) instead of up.
 */
function hand(x: number, y: number, open: number, palm = 0.05, facing = false): Point[] {
  const pts: Point[] = Array.from({ length: 21 }, () => ({ x, y, z: 0 }));
  // a direction "up the palm", either in the image or into the screen
  const put = (along: number, side: number): Point =>
    facing ? { x: x + side / ASPECT, y, z: -along / ASPECT } : { x: x + side / ASPECT, y: y - along, z: 0 };
  const bend = Math.PI * (1 - open);
  [[5, 8], [9, 12], [13, 16], [17, 20]].forEach(([k, t], i) => {
    const side = (i - 1.5) * palm * 0.3;
    pts[k] = put(palm, side);
    // the finger: from the knuckle, turned back by `bend`
    const fx = Math.cos(bend) * palm * 0.8;
    const fy = Math.sin(bend) * palm * 0.8;
    pts[t] = facing ? { x: x + side / ASPECT, y: y + fy, z: -(palm + fx) / ASPECT } : { x: x + side / ASPECT + fy / ASPECT, y: y - palm - fx, z: 0 };
  });
  return pts;
}

describe("letting go by opening the drawing hand", () => {
  it("reads a fist as closed and a flat hand as open, at any distance", () => {
    const fist = handOpenness(hand(0.5, 0.5, 0.1), ASPECT)!;
    const open = handOpenness(hand(0.5, 0.5, 1), ASPECT)!;
    expect(fist).toBeLessThan(0.2);
    expect(open).toBeGreaterThan(0.9);
    expect(handOpenness(hand(0.5, 0.5, 1, 0.02), ASPECT)!).toBeCloseTo(open, 5);
  });

  it("still reads it when the hand points at the camera (the playtest bug: 2D distances barely changed)", () => {
    const fist = handOpenness(hand(0.5, 0.5, 0.1, 0.05, true), ASPECT)!;
    const open = handOpenness(hand(0.5, 0.5, 1, 0.05, true), ASPECT)!;
    expect(open - fist).toBeGreaterThan(DEFAULT_BOW.openBy);
    expect(open).toBeGreaterThan(DEFAULT_BOW.openAt);
  });

  it("reads the hand at the drawing wrist, not the aiming one", () => {
    const lm = body([0.5, 0.3], [-1.5, 0.3]);
    const pull = lm[LM.rightWrist];
    const aimW = lm[LM.leftWrist];
    const hands = [{ points: hand(aimW.x, aimW.y, 1) }, { points: hand(pull.x, pull.y, 0.1) }];
    expect(drawHandOpenness(lm, hands, ASPECT, "left")!).toBeLessThan(0.2);
    // no hand near the drawing wrist: no reading
    expect(drawHandOpenness(lm, [hands[0]], ASPECT, "left")).toBeNull();
  });

  /** Draws with a closed hand for `n` frames, then opens it, keeping the draw. */
  function drawThenOpen(t: BowTracker, draw: number, open = 1) {
    const events: BowEvent[] = [];
    for (let i = 0; i < 20; i++) {
      const e = t.update({ yaw: 0.1, pitch: 0.05, draw: (draw * (i + 1)) / 20 }, i * 33, 0.1);
      if (e) events.push(e);
    }
    const e = t.update({ yaw: 0.1, pitch: 0.05, draw }, 700, open);
    if (e) events.push(e);
    return events;
  }

  it("opening the hand at full draw shoots with that draw, no snap needed", () => {
    const events = drawThenOpen(new BowTracker(), 0.8);
    const release = events.at(-1)!;
    expect(release.t).toBe("release");
    expect(release.t === "release" && release.draw).toBeCloseTo(0.8, 5);
  });

  it("a half-open hand doesn't fire; nor does opening it before the minimum draw", () => {
    expect(drawThenOpen(new BowTracker(), 0.8, 0.35).some((e) => e.t === "release")).toBe(false);
    expect(drawThenOpen(new BowTracker(), MIN_DRAW / 2).some((e) => e.t === "release")).toBe(false);
  });

  it("a hand lost for a moment keeps its reading, so opening right after still shoots (playtest)", () => {
    const t = new BowTracker();
    for (let i = 0; i < 20; i++) t.update({ yaw: 0, pitch: 0, draw: (0.8 * (i + 1)) / 20 }, i * 33, 0.1);
    // pulled back by the face: the hand model loses it for a few frames
    expect(t.update({ yaw: 0, pitch: 0, draw: 0.8 }, 700, null)?.t).toBe("aim");
    expect(t.update({ yaw: 0, pitch: 0, draw: 0.8 }, 733, null)?.t).toBe("aim");
    expect(t.update({ yaw: 0, pitch: 0, draw: 0.8 }, 766, 1)?.t).toBe("release");
  });

  it("a long loss forgets the old reading", () => {
    const t = new BowTracker();
    t.update({ yaw: 0, pitch: 0, draw: 0.8 }, 0, 1);
    // still drawn, nothing read for longer than the hold: nothing to shoot on
    expect(t.update({ yaw: 0, pitch: 0, draw: 0.8 }, HAND_HOLD_MS + 50, null)?.t).toBe("aim");
  });

  it("a slow, closed return still lets the draw down", () => {
    const t = new BowTracker();
    const events = [...ramp(0, 0.8, 15), ...ramp(0.8, 0, 40)]
      .map((draw, i) => t.update({ yaw: 0, pitch: 0, draw }, i * 33, 0.1))
      .filter((e): e is BowEvent => e !== null);
    expect(events.some((e) => e.t === "release")).toBe(false);
    expect(events).toContainEqual({ t: "letdown" });
  });
});
