import { beforeAll, describe, expect, it } from "vitest";
import { CONTACT, shotLabel, strokePose } from "../client/games/tennis/stroke.ts";
import type { Player } from "../client/games/tennis/character.ts";

// Task 6: the forehand and backhand are separate arcs, measured on the real
// character rig (racket head in the player's own frame: x to their right,
// y up, z toward the net), not just a racket that changes side.

let makePlayer: (shirt: number, hair: number, racket: number) => Player;

beforeAll(async () => {
  // the character draws its face and strings on a canvas; Node has none, and
  // the measurement only needs the bones
  const noop: () => unknown = new Proxy(() => {}, { get: () => noop, apply: () => noop });
  (globalThis as { document?: unknown }).document ??= { createElement: () => ({ getContext: () => noop }) };
  ({ makePlayer } = await import("../client/games/tennis/character.ts"));
});

function path(p: Player, backhand: boolean, side: 1 | -1 = 1) {
  return [0, CONTACT, 1].map((t) => {
    p.pose(t, backhand, side);
    return p.racketHead();
  });
}

describe("stroke animation", () => {
  it("forehand starts and meets the ball on the racket side, backhand on the other", () => {
    const p = makePlayer(0, 0, 0);
    const [fStart, fContact] = path(p, false);
    const [bStart, bContact] = path(p, true);
    // taken back behind the player (away from the net) on opposite sides
    expect(fStart.x).toBeGreaterThan(0.4);
    expect(bStart.x).toBeLessThan(-0.2);
    expect(fStart.z).toBeLessThan(-0.3);
    expect(bStart.z).toBeLessThan(-0.3);
    // contact out in front, mirrored
    expect(fContact.x).toBeGreaterThan(0.4);
    expect(bContact.x).toBeLessThan(-0.4);
    expect(fContact.z).toBeGreaterThan(0.5);
    expect(bContact.z).toBeGreaterThan(0.5);
  });

  it("each sweeps the other way and finishes on the opposite side", () => {
    const p = makePlayer(0, 0, 0);
    const [fStart, , fEnd] = path(p, false);
    const [bStart, , bEnd] = path(p, true);
    // forehand: right to left, low to high
    expect(fEnd.x).toBeLessThan(fStart.x - 0.6);
    expect(fEnd.y).toBeGreaterThan(fStart.y + 0.6);
    // backhand: left to right
    expect(bEnd.x).toBeGreaterThan(bStart.x + 0.8);
    // finishes at least half a metre apart
    expect(Math.hypot(fEnd.x - bEnd.x, fEnd.y - bEnd.y, fEnd.z - bEnd.z)).toBeGreaterThan(0.5);
  });

  it("the shoulders turn opposite ways through each stroke", () => {
    const f0 = strokePose(0, false).bodyY;
    const f1 = strokePose(1, false).bodyY;
    const b0 = strokePose(0, true).bodyY;
    const b1 = strokePose(1, true).bodyY;
    // forehand coils away (clockwise) and unwinds toward the net; backhand the reverse
    expect(f0).toBeLessThan(-0.4);
    expect(b0).toBeGreaterThan(0.4);
    expect(f1 - f0).toBeGreaterThan(0.8);
    expect(b1 - b0).toBeLessThan(-0.8);
    // and the racket face is turned over for the backhand
    expect(Math.sign(strokePose(CONTACT, false).roll)).toBe(-Math.sign(strokePose(CONTACT, true).roll));
  });

  it("a left-hander is the mirror image", () => {
    const p = makePlayer(0, 0, 0);
    for (const backhand of [false, true]) {
      const right = path(p, backhand, 1);
      const left = path(p, backhand, -1);
      for (let i = 0; i < 3; i++) {
        expect(left[i].x).toBeCloseTo(-right[i].x, 5);
        expect(left[i].y).toBeCloseTo(right[i].y, 5);
        expect(left[i].z).toBeCloseTo(right[i].z, 5);
      }
    }
  });

  it("is continuous: no 1/25 of the stroke jumps the racket more than 0.5 m", () => {
    const p = makePlayer(0, 0, 0);
    for (const backhand of [false, true]) {
      let prev = (p.pose(0, backhand, 1), p.racketHead());
      for (let i = 1; i <= 25; i++) {
        p.pose(i / 25, backhand, 1);
        const h = p.racketHead();
        expect(Math.hypot(h.x - prev.x, h.y - prev.y, h.z - prev.z)).toBeLessThan(0.5);
        prev = h;
      }
    }
  });
});

describe("shot label", () => {
  it("names the stroke, and for the opponent who played it", () => {
    expect(shotLabel("forehand", null)).toEqual({ text: "FOREHAND", note: "", wrongSide: false });
    expect(shotLabel("backhand", "late", "Bot")).toEqual({ text: "BACKHAND", note: "Bot", wrongSide: false });
  });

  it("a wrong-side miss says which stroke the ball needed", () => {
    expect(shotLabel("forehand", "wrong side")).toEqual({ text: "FOREHAND", note: "Wrong side: ball was on your backhand", wrongSide: true });
    expect(shotLabel("backhand", "wrong side").note).toMatch(/forehand/);
  });

  it("a swing at a dead ball says it had already landed out, or bounced twice (task 12)", () => {
    expect(shotLabel("forehand", "out")).toEqual({ text: "FOREHAND", note: "Too late: the ball had already landed out", wrongSide: false });
    expect(shotLabel("backhand", "two bounces").note).toMatch(/bounced twice/);
  });
});
