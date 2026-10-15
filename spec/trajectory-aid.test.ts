import { describe, expect, it } from "vitest";
import {
  TIMINGS,
  TIMING_U,
  litTiming,
  meterPosition,
  realArc,
  shownStrength,
  strengthPosition,
  timingArcs,
  windowPosition, stanceHint } from "../client/games/tennis/trajectory-aid.ts";
import { DEFAULT_SWING, levelFromSpeed } from "../client/input/camera/pose.ts";
import { cloneState, createState, missReason, other, seatZ, step, timingAim } from "../shared/games/tennis/sim.ts";
import type { Hand, Level, Seat, SwingKind, TennisState } from "../shared/games/tennis/sim.ts";

/** A rally ball 6 m short of `seat`'s baseline, coming at them, with `seat` standing where it will arrive. */
function incoming(seat: Seat): TennisState {
  const s = createState(7, { endless: true });
  const toward = seat === 0 ? 1 : -1;
  s.phase = "rally";
  s.lastHitter = other(seat);
  s.shots = 2;
  s.bounces = 1;
  s.ball = { x: 0.6, y: 1.1, z: seatZ(seat) - toward * 6, vx: 0.3 * toward, vy: 2.5, vz: 15 * toward };
  // where it crosses the baseline: x moves 0.3 m/s for 0.4 s
  const x = 0.6 + 0.3 * toward * 0.4;
  s.players[seat] = { x, targetX: x };
  return s;
}

/** A moment of the aid that must exist (a ball that stays live has all three). */
function present<T>(x: T | null): T {
  expect(x).not.toBeNull();
  return x as T;
}

const SEATS = [0, 1] as const;
const HANDS: Hand[] = ["right", "left"];
const KINDS: SwingKind[] = ["forehand", "backhand"];

describe("trajectory aid: three timing arcs", () => {
  for (const seat of SEATS) {
    for (const hand of HANDS) {
      for (const kind of KINDS) {
        it(`seat ${seat}, ${hand}-handed ${kind}: each arc goes the way timingAim sends a real hit at that moment`, () => {
          const s = incoming(seat);
          const aid = timingArcs(s, seat, 1, hand, kind);
          expect(aid).not.toBeNull();
          expect(aid!.kind).toBe(kind);

          TIMINGS.forEach((timing, i) => {
            const arc = present(aid!.arcs[i]);
            expect(arc.farSide, `${timing} lands on the opponent's half`).toBe(true);
            const predicted = arc.x - arc.path[0].x;

            // the real thing: run to that moment of the window and swing, aiming by timing
            const real = cloneState(s);
            while ((windowPosition(real, seat) ?? -Infinity) < TIMING_U[i]) step(real, []);
            const aim = timingAim(real.ball, seat, kind, hand);
            const contactX = real.ball.x;
            const ev = step(real, [{ t: "swing", seat, dirX: 0, kind, level: 1, hand, timingAim: true }]);
            expect(ev.find((e) => e.type === "swing")).toEqual({ type: "swing", seat, outcome: "hit" });
            const at = real.lastBounce?.tick;
            for (let n = 0; n < 300 && real.lastBounce?.tick === at; n++) step(real, []);
            const actual = real.lastBounce!.x - contactX;

            if (timing === "ontime") {
              expect(Math.abs(predicted), "on time goes straight").toBeLessThan(0.05);
              expect(Math.abs(actual)).toBeLessThan(0.4);
            } else {
              expect(Math.abs(aim)).toBeGreaterThan(0.3);
              expect(Math.sign(predicted), `${timing}: arc on timingAim's side`).toBe(Math.sign(aim));
              expect(Math.sign(actual), `${timing}: real hit on the same side`).toBe(Math.sign(aim));
            }
          });
          // early and late are mirror images either side of straight
          const early = present(aid!.arcs[0]);
          const late = present(aid!.arcs[2]);
          expect(Math.sign(early.x - early.path[0].x)).toBe(-Math.sign(late.x - late.path[0].x));
        });
      }
    }
  }

  it("forehand and backhand mirror early and late", () => {
    const s = incoming(0);
    const fore = timingArcs(s, 0, 1, "right", "forehand")!;
    const back = timingArcs(s, 0, 1, "right", "backhand")!;
    const side = (a: typeof fore, i: number) => {
      const arc = present(a.arcs[i]);
      return Math.sign(arc.x - arc.path[0].x);
    };
    expect(side(fore, 0)).toBe(-side(back, 0));
    expect(side(fore, 2)).toBe(-side(back, 2));
  });

  it("without a grip, uses the swing that suits the ball's side", () => {
    const s = incoming(0);
    s.players[0] = { x: -0.5, targetX: -0.5 };
    // ball to the right of a right-hander facing -z: forehand
    expect(timingArcs(s, 0, 1, "right")!.kind).toBe("forehand");
  });

  it("depth ticks: at every timing, light lands shortest and hard deepest; the arc's own level is its landing", () => {
    const s = incoming(0);
    for (const level of [0, 1, 2] as const) {
      const aid = timingArcs(s, 0, level, "right", "forehand")!;
      aid.ticks.forEach((maybe, i) => {
        const row = present(maybe);
        const depth = row.map((t) => -t.z);
        expect(depth[0]).toBeLessThan(depth[1]);
        expect(depth[1]).toBeLessThan(depth[2]);
        expect(row.every((t) => t.farSide)).toBe(true);
        expect(row[level].x).toBe(present(aid.arcs[i]).x);
        expect(row[level].z).toBe(present(aid.arcs[i]).z);
      });
    }
  });

  it("shows nothing when no ball is coming at you", () => {
    const s = createState(1, { endless: true });
    expect(timingArcs(s, 0, 1, "right")).toBeNull();
    expect(windowPosition(s, 0)).toBeNull();
    const mine = incoming(0);
    mine.lastHitter = 0;
    expect(timingArcs(mine, 0, 1, "right")).toBeNull();
  });
});

describe("trajectory aid: the lit arc and the meter follow the ball", () => {
  for (const seat of SEATS) {
    it(`seat ${seat}: none lit on the way, then early, on time, late, matching timingAim at every tick`, () => {
      const s = incoming(seat);
      const seen: (string | null)[] = [];
      for (let n = 0; n < 120; n++) {
        const u = windowPosition(s, seat);
        const lit = litTiming(u);
        if (seen.at(-1) !== lit) seen.push(lit);
        if (lit) {
          const aim = timingAim(s.ball, seat, "forehand", "right");
          if (lit === "ontime") expect(Math.abs(aim)).toBeLessThanOrEqual(1 / 3 + 1e-9);
          else {
            const arcs = timingArcs(s, seat, 1, "right", "forehand");
            // past the baseline the arcs come from the ball where it is now
            if (arcs) {
              const i = TIMINGS.indexOf(lit);
              const arc = present(arcs.arcs[i]);
              expect(Math.sign(arc.x - arc.path[0].x)).toBe(Math.sign(aim));
            }
            expect(Math.abs(aim)).toBeGreaterThan(1 / 3 - 1e-9);
          }
          const m = meterPosition(u)!;
          expect(m).toBeGreaterThanOrEqual(0);
          expect(m).toBeLessThanOrEqual(1);
        }
        step(s, []);
      }
      expect(seen.slice(0, 4)).toEqual([null, "early", "ontime", "late"]);
    });
  }

  it("meter: early edge, middle, late edge, and clamped outside", () => {
    expect(meterPosition(-1)).toBe(0);
    expect(meterPosition(0)).toBe(0.5);
    expect(meterPosition(1)).toBe(1);
    expect(meterPosition(-3)).toBe(0);
    expect(meterPosition(4)).toBe(1);
    expect(meterPosition(null)).toBeNull();
  });

  it("lit thirds of the window", () => {
    expect(litTiming(-1.2)).toBeNull();
    expect(litTiming(-0.9)).toBe("early");
    expect(litTiming(0)).toBe("ontime");
    expect(litTiming(0.9)).toBe("late");
    expect(litTiming(1.2)).toBeNull();
    expect(litTiming(null)).toBeNull();
  });
});

describe("trajectory aid: strength ticks", () => {
  const thr = DEFAULT_SWING.thresholds;

  it("slides continuously with peak speed, crossing the tick boundaries at the thresholds", () => {
    expect(strengthPosition(0, thr)).toBe(0);
    expect(strengthPosition(thr[0], thr)).toBeCloseTo(0.5);
    expect(strengthPosition(thr[1], thr)).toBeCloseTo(1.5);
    expect(strengthPosition(100, thr)).toBe(2);
    let prev = -1;
    for (let p = 0; p < 20; p += 0.25) {
      const pos = strengthPosition(p, thr);
      expect(pos).toBeGreaterThanOrEqual(prev);
      prev = pos;
    }
  });

  it("highlights the last swing's level; mid-swing, the level the peak so far would give", () => {
    expect(shownStrength(2, null, thr)).toEqual({ level: 2, position: 2, live: false });
    expect(shownStrength(null, null, thr)).toEqual({ level: 1, position: 1, live: false });
    for (let p = 0; p < 20; p += 0.5) {
      const shown = shownStrength(0, p, thr);
      expect(shown.live).toBe(true);
      expect(shown.level).toBe(levelFromSpeed(p, thr, 0, DEFAULT_SWING.hysteresis));
    }
  });
});

describe("trajectory aid: the real arc after the hit", () => {
  it("starts at contact and ends where the server's ball first lands", () => {
    const s = incoming(0);
    while ((windowPosition(s, 0) ?? -Infinity) < 0) step(s, []);
    step(s, [{ t: "swing", seat: 0, dirX: 0.5, kind: "forehand", level: 2 as Level }]);
    expect(s.lastHitter).toBe(0);
    const path = realArc(s);
    expect(path[0]).toEqual({ x: s.ball.x, y: s.ball.y, z: s.ball.z });
    const at = s.lastBounce?.tick;
    while (s.lastBounce?.tick === at) step(s, []);
    const end = path.at(-1)!;
    expect(end.x).toBeCloseTo(s.lastBounce!.x, 5);
    expect(end.z).toBeCloseTo(s.lastBounce!.z, 5);
    expect(end.y).toBe(0);
  });
});

describe("a ball that will land out can still be volleyed, so its early arc shows", () => {
  /** A hard, wide shot from seat 1 at seat 0: it lands out beside the court, going dead at the bounce. */
  function wideHard(): TennisState {
    const s = createState(2, { endless: true });
    s.phase = "rally";
    s.lastHitter = 0;
    s.shots = 3;
    s.ball = { x: 0, y: 1, z: seatZ(1), vx: 0, vy: 0, vz: -5 };
    s.players[0] = { x: 0, targetX: 0 };
    s.players[1] = { x: 0, targetX: 0 };
    step(s, [{ t: "swing", seat: 1, kind: "forehand", level: 2 as Level, dirX: 1 }]);
    return s;
  }

  it("keeps the arcs for moments the ball is still in the air and drops the ones after it goes dead", () => {
    const s = wideHard();
    // run until the window opens (the ball is still live then)
    for (let i = 0; i < 400 && (windowPosition(s, 0) ?? -2) < -0.95; i++) step(s, []);
    const aid = timingArcs(s, 0, 1, "right", "forehand");
    expect(aid, "an out ball that can still be hit gets an aid").not.toBeNull();
    expect(aid!.arcs[0], "early is hit before the bounce").not.toBeNull();
    expect(aid!.arcs[2], "late is after it has gone dead").toBeNull();
    expect(aid!.ticks[2]).toBeNull();
  });

  it("a ball that lands in still gets all three", () => {
    const s = incoming(0);
    const aid = timingArcs(s, 0, 1, "right", "forehand")!;
    expect(aid.arcs.every((a) => a !== null)).toBe(true);
    expect(aid.ticks.every((t) => t !== null)).toBe(true);
  });

  it("no arcs once the ball has gone dead", () => {
    const s = wideHard();
    for (let i = 0; i < 400 && !s.pending?.dead; i++) step(s, []);
    expect(s.pending?.dead).toBe(true);
    expect(timingArcs(s, 0, 1, "right", "forehand")).toBeNull();
  });
});

describe("stance hint: which stroke your next swing is, and whether your grip is wrong for the ball's side", () => {
  /** A ball coming at seat 0 that will cross its baseline `side` metres to the right of where the player stands. */
  function ballAt(side: number): TennisState {
    const s = incoming(0);
    s.players[0] = { x: 0, targetX: 0 };
    // aim the ball so it crosses the baseline `side` m from the player (positive: their right)
    const toBaseline = (seatZ(0) - s.ball.z) / s.ball.vz;
    s.ball.vx = (side - s.ball.x) / toBaseline;
    return s;
  }

  it("says nothing when no ball is coming at you", () => {
    const s = createState(1, { endless: true });
    expect(stanceHint(s, 0, "right", null)).toBeNull();
  });

  it("keys (no grip): the stroke the ball's side calls for, never a warning", () => {
    expect(stanceHint(ballAt(1.5), 0, "right", null)).toMatchObject({ kind: "forehand", wrong: false });
    expect(stanceHint(ballAt(-1.5), 0, "right", null)).toMatchObject({ kind: "backhand", wrong: false });
    // a left-hander's sides are the other way round
    expect(stanceHint(ballAt(1.5), 0, "left", null)).toMatchObject({ kind: "backhand", wrong: false });
  });

  it("camera: the right grip for the side is shown plainly", () => {
    expect(stanceHint(ballAt(1.5), 0, "right", "forehand")).toMatchObject({ kind: "forehand", wrong: false });
    expect(stanceHint(ballAt(-1.5), 0, "right", "backhand")).toMatchObject({ kind: "backhand", wrong: false });
  });

  it("camera: the wrong grip for the side is flagged, and says which grip the ball needs", () => {
    const h = stanceHint(ballAt(1.5), 0, "right", "backhand")!;
    expect(h).toMatchObject({ kind: "backhand", wrong: true, needs: "forehand" });
    expect(h.text).toMatch(/forehand/i);
    expect(stanceHint(ballAt(-1.5), 0, "right", "forehand")).toMatchObject({ wrong: true, needs: "backhand" });
  });

  it("within the sim's either-side zone no grip is wrong, so the hint never flickers when you are lined up", () => {
    for (const side of [0, 0.1, -0.1, 0.25, -0.25]) {
      for (const grip of ["forehand", "backhand"] as const) {
        expect(stanceHint(ballAt(side), 0, "right", grip), `${side} m, ${grip}`).toMatchObject({ wrong: false });
      }
    }
  });

  it("agrees with the sim: it flags a grip exactly when a swing of that kind would be a wrong-side miss", () => {
    // balls within reach of the player (further out the sim says "reach", a different miss)
    for (const side of [-1.3, -1, -0.5, -0.2, 0, 0.2, 0.5, 1, 1.3]) {
      for (const grip of ["forehand", "backhand"] as const) {
        const s = ballAt(side);
        // run the ball to the baseline so the sim's own rule applies at the contact
        for (let n = 0; n < 600 && (s.ball.z - seatZ(0)) * Math.sign(seatZ(0)) < 0; n++) step(s, []);
        const miss = missReason(s, 0, grip, "right");
        const hint = stanceHint(ballAt(side), 0, "right", grip)!;
        expect(hint.wrong, `${side} m, ${grip}`).toBe(miss === "wrong side");
      }
    }
  });
});

