// Task 12: rally fixes. A ball going out can still be hit (or left); once it
// has landed out it is dead. The bot lets go a ball it predicts will land out.
// The hit window is 0.32 s either side of the baseline. And a sweep over many
// seeded rallies checks that every point goes where the ball says it should.
import { describe, expect, it } from "vitest";
import { botInputs } from "../shared/games/tennis/bot.ts";
import { tennisFrom } from "../shared/games/tennis/index.ts";
import { litTiming, windowPosition } from "../client/games/tennis/trajectory-aid.ts";
import {
  COURT,
  DT,
  HIT_WINDOW_S,
  PLAYER,
  SWING_LEAD_TICKS,
  createState,
  missReason,
  naturalKind,
  predictContact,
  swingTiming,
  other,
  seatZ,
  snapshot,
  step,
} from "../shared/games/tennis/sim.ts";
import type { Ball, Level, Seat, TennisEvent, TennisInput, TennisSnapshot, TennisState } from "../shared/games/tennis/sim.ts";

/** Seat 1 receives `ball` from seat 0 in a rally (not a serve), standing at `x`, moving only when told. */
function receiving(ball: Ball, x: number): TennisState {
  const s = createState(1);
  s.phase = "rally";
  s.lastHitter = 0;
  s.shots = 2;
  s.ball = { ...ball };
  s.players[1] = { x, targetX: x };
  return s;
}

const swingAt = (s: TennisState, seat: Seat = 1, level: Level = 1): TennisInput => ({
  t: "swing",
  seat,
  dirX: 0,
  kind: naturalKind(seat, s.players[seat].x, s.ball.x),
  level,
});

const outcome = (ev: TennisEvent[], seat: Seat) => {
  const e = ev.find((x) => x.type === "swing" && x.seat === seat);
  return e?.type === "swing" ? e.outcome : null;
};

// Just past seat 1's baseline and about to touch down there, out: one tick
// from landing 0.5 m long, in reach and in the hit window.
const longBall: Ball = { x: 0, y: 0.05, z: -COURT.halfL - 0.3, vx: 0, vy: -4, vz: -14 };

describe("a ball going out (task 12)", () => {
  it("can still be hit while it is in the air: the receiver's choice", () => {
    const s = receiving(longBall, 0.5);
    expect(missReason(s, 1)).toBeNull();
    expect(outcome(step(s, [swingAt(s)]), 1)).toBe("hit");
    expect(s.lastHitter).toBe(1);
  });

  it("once it has landed out it is dead: a swing is a miss, and the out point stands", () => {
    const s = receiving(longBall, 0.5);
    step(s, []);
    expect(s.lastBounce).toMatchObject({ in: false });
    // still in the window and in reach: only having landed out makes it dead
    expect(Math.abs(s.ball.z - seatZ(1))).toBeLessThan(Math.abs(s.ball.vz) * HIT_WINDOW_S);
    expect(Math.abs(s.ball.x - s.players[1].x)).toBeLessThan(PLAYER.reach);
    expect(missReason(s, 1)).toBe("out");
    for (let i = 0; i < 4; i++) expect(outcome(step(s, [swingAt(s)]), 1)).toBe("out");
    let point: TennisEvent | undefined;
    for (let i = 0; i < 60 && !point; i++) point = step(s, []).find((e) => e.type === "point");
    expect(point).toMatchObject({ type: "point", winner: 1, reason: "out" });
  });

  it("a ball that bounced twice is dead too: a swing is a miss", () => {
    // bounced in once already, about to bounce again in front of seat 1
    const s = receiving({ x: 0, y: 0.02, z: -COURT.halfL + 0.4, vx: 0, vy: -2, vz: -8 }, 0.5);
    s.bounces = 1;
    step(s, []);
    expect(s.pending).toMatchObject({ reason: "unreturned", dead: true });
    expect(missReason(s, 1)).toBe("two bounces");
    expect(outcome(step(s, [swingAt(s)]), 1)).toBe("two bounces");
  });

  it("a wide ball that lands out before your baseline: contact is its last moment in the air, then nothing", () => {
    // lands out over the sideline about 1 m short of seat 1's baseline
    const s = receiving({ x: 4, y: 0.5, z: -COURT.halfL + 2.5, vx: 2, vy: -3, vz: -14 }, 3.6);
    const c = predictContact(s, 1);
    expect(c).not.toBeNull();
    // the camera client still sends a swing at it: it can be volleyed
    expect(swingTiming(s, 1)).toBe("ready");
    for (let i = 0; i < c!.ticks; i++) step(s, []);
    expect(s.lastBounce).toBeNull();
    expect(s.ball.x).toBeCloseTo(c!.ball.x, 9);
    expect(missReason(s, 1)).toBeNull();
    step(s, []);
    expect(s.lastBounce).toMatchObject({ in: false });
    expect(predictContact(s, 1)).toBeNull();
    expect(swingTiming(s, 1)).toBe("none");
  });

  it("a lagged swing from while it was still in the air is rewound and counts (ADR 001)", () => {
    const g = tennisFrom(receiving(longBall, 0.5));
    g.step([]); // lands out
    g.step([]);
    const kind = naturalKind(1, 0.5, longBall.x);
    const swing = { seat: 1 as const, input: { t: "swing", dirX: 0, kind, level: 1 } };
    // judged at a tick after it landed: refused
    expect(g.rewind!(swing, 1)).toBeNull();
    // judged at the tick it was still in the air: a hit
    expect(g.rewind!(swing, 2)).toContainEqual({ type: "swing", seat: 1, outcome: "hit" });
    const after = g.snapshot() as TennisSnapshot;
    expect(after.lastHitter).toBe(1);
    expect(after.pending).toBeNull();
  });
});

/** Seat 1 runs the bot (standing still, so the test controls reach) until the point; returns whether it swung. */
function botPlays(ball: Ball | TennisState, x = 0): { swung: boolean; s: TennisState; point: TennisEvent | undefined } {
  const s = "ball" in ball ? ball : receiving(ball, x);
  let swung = false;
  let point: TennisEvent | undefined;
  for (let i = 0; i < 300 && s.lastHitter === 0 && s.phase === "rally"; i++) {
    const inputs = botInputs(s, 1).filter((x) => x.t === "swing");
    swung ||= inputs.length > 0;
    point ??= step(s, inputs).find((e) => e.type === "point");
  }
  return { swung, s, point };
}

describe("the bot lets go a ball it predicts will land out (task 12)", () => {
  // crosses seat 1's baseline about 1 m up and lands about 3 m long
  const goingOut: Ball = { x: 0.4, y: 1.41, z: -COURT.halfL + 8.4, vx: 0, vy: 2.26, vz: -14 };
  // lands about 1 m inside seat 1's baseline
  const landingIn: Ball = { x: 0.4, y: 1.2, z: -2, vx: 0, vy: 1, vz: -14 };

  it("does not swing at a long ball, which lands out and is the bot's point", () => {
    const { swung, s, point } = botPlays(goingOut, 0.4 + 0.6);
    expect(swung).toBe(false);
    expect(s.lastBounce).toMatchObject({ in: false });
    expect(point).toMatchObject({ winner: 1, reason: "out" });
  });

  it("still returns a ball that lands in", () => {
    const { swung, s } = botPlays(landingIn, 0.4 + 0.6);
    expect(swung).toBe(true);
    expect(s.lastHitter).toBe(1);
  });

  it("still plays a ball that has landed in, whatever happens after", () => {
    const s = receiving({ ...landingIn }, 1);
    while (s.bounces === 0) step(s, []);
    expect(s.lastBounce).toMatchObject({ in: true });
    const { swung } = botPlays(s);
    expect(swung).toBe(true);
  });
});

describe("hit window (task 12)", () => {
  // a rally ball at 14 m/s, `t` seconds before (+) or after (-) seat 1's baseline
  const at = (t: number) => receiving({ x: 0, y: 1, z: -COURT.halfL + 14 * t, vx: 0, vy: 0, vz: -14 }, 0);

  it("is 0.32 s either side of the baseline, so early, on time and late are about 0.21 s each", () => {
    expect(HIT_WINDOW_S).toBeCloseTo(0.32, 6);
    expect((2 * HIT_WINDOW_S) / 3).toBeCloseTo(0.213, 3);
    expect(missReason(at(0.3), 1)).toBeNull();
    expect(missReason(at(-0.3), 1)).toBeNull();
    expect(missReason(at(0.34), 1)).toBe("early");
    expect(missReason(at(-0.34), 1)).toBe("late");
  });

  it("each third is about 0.21 s: the aid lights early, on time and late at those times", () => {
    const lit = (t: number) => litTiming(windowPosition(at(t), 1));
    expect(lit(0.31)).toBe("early");
    expect(lit(0.115)).toBe("early");
    expect(lit(0.1)).toBe("ontime");
    expect(lit(-0.1)).toBe("ontime");
    expect(lit(-0.115)).toBe("late");
    expect(lit(-0.31)).toBe("late");
    expect(lit(0.33)).toBeNull();
  });

  it("the camera's early cut-off still covers the whole window", () => {
    expect(SWING_LEAD_TICKS * DT).toBeGreaterThanOrEqual(HIT_WINDOW_S);
    expect(SWING_LEAD_TICKS * DT).toBeLessThan(HIT_WINDOW_S + 0.1);
  });
});

// ---------------------------------------------------------------------------
// Point consistency (user report: "I hit it out and still get the point").
// A referee with its own copy of the ball physics watches every tick and
// decides each point from where the ball touched down and who hit it last;
// the sim's call must agree, every time.

/** One tick of flight, written out again here so the referee doesn't lean on the sim's code. */
function fly(b: Ball): "net" | "bounce" | null {
  const prevZ = b.z;
  b.vy -= COURT.gravity * DT;
  b.x += b.vx * DT;
  b.y += b.vy * DT;
  b.z += b.vz * DT;
  if (prevZ > 0 !== b.z > 0 && b.y < COURT.netH) return "net";
  if (b.y < 0) {
    b.y = 0;
    b.vy = -b.vy * COURT.restitution;
    return "bounce";
  }
  return null;
}

type Call = { winner: Seat; reason: string; touchedDown: boolean };

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Plays a seeded match: seat 1 is the bot, seat 0 a careless person in auto
 * who swings at random moments around the window (before, during and after a
 * touchdown) with any strength and aim. Returns the mismatches the referee
 * found, how many points it checked, and the final snapshot.
 */
function refereed(seed: number, ticks: number): { problems: string[]; points: number; final: TennisSnapshot } {
  const s = createState(seed, { moveMode: "auto", endless: true });
  const rand = mulberry(seed * 7919);
  const problems: string[] = [];
  let points = 0;
  let hitter: Seat | null = null;
  let good = 0; // good touchdowns since the last hit
  let call: Call | null = null;
  for (let i = 0; i < ticks; i++) {
    const inputs: TennisInput[] = botInputs(s, 1);
    const heading = s.ball.vz > 0;
    const past = s.ball.z - seatZ(0);
    if (s.phase === "rally" && s.lastHitter === 1 && heading && Math.abs(past) < 6 && rand() < 0.12) {
      inputs.push({
        t: "swing",
        seat: 0,
        dirX: rand() * 2 - 1,
        kind: naturalKind(0, s.players[0].x, s.ball.x),
        level: Math.floor(rand() * 3) as Level,
        timingAim: rand() < 0.5 ? true : undefined,
      });
    }
    const phaseBefore = s.phase;
    const ball = { ...s.ball };
    const ev = step(s, inputs);
    const hit = ev.find((e) => e.type === "swing" && e.outcome === "hit");
    const scored = ev.find((e) => e.type === "point" || e.type === "fault");
    const where = `seed ${seed} tick ${s.tick}`;

    if (phaseBefore === "serve" && s.phase === "rally") {
      hitter = s.lastHitter;
      good = 0;
      call = null;
      continue;
    }
    if (hit?.type === "swing") {
      if (call?.touchedDown) problems.push(`${where}: seat ${hit.seat} hit a ball that had already been called ${call.reason}`);
      hitter = hit.seat;
      good = 0;
      call = null;
    } else if (phaseBefore === "rally" && hitter !== null) {
      // the referee's own flight of the ball this tick
      const event = fly(ball);
      if (!call?.touchedDown) {
        const hitterSide = hitter === 0 ? 1 : -1;
        if (event === "net" && !call) call = { winner: other(hitter), reason: "net", touchedDown: true };
        else if (event === "bounce") {
          const inBounds = Math.abs(ball.x) <= COURT.halfW && Math.abs(ball.z) <= COURT.halfL;
          if (good === 0 && Math.sign(ball.z) === hitterSide)
            call = { winner: other(hitter), reason: inBounds ? "own side" : "out", touchedDown: true };
          else if (!inBounds && good === 0) call = { winner: other(hitter), reason: "out", touchedDown: true };
          else if (!call) {
            good++;
            if (good >= 2) call = { winner: hitter, reason: "unreturned", touchedDown: true };
          }
        } else if (!call && Math.sign(ball.z) !== hitterSide && Math.abs(ball.z) > COURT.halfL + COURT.endMargin) {
          // flew past the end, still in the air: decided, but still playable
          call = good >= 1 ? { winner: hitter, reason: "unreturned", touchedDown: false } : { winner: other(hitter), reason: "out", touchedDown: false };
        }
      }
    }
    if (scored) {
      points++;
      if (!call) problems.push(`${where}: ${JSON.stringify(scored)} with no call from the referee`);
      else if (scored.type === "fault") {
        if (scored.server !== hitter || call.winner === hitter || scored.reason !== call.reason)
          problems.push(`${where}: fault ${JSON.stringify(scored)} but the referee says ${JSON.stringify(call)}`);
      } else if (scored.reason === "double fault") {
        if (scored.winner !== other(hitter as Seat) || call.winner === hitter)
          problems.push(`${where}: ${JSON.stringify(scored)} but the referee says ${JSON.stringify(call)}`);
      } else if (scored.winner !== call.winner || scored.reason !== call.reason) {
        problems.push(`${where}: ${JSON.stringify(scored)} but the referee says ${JSON.stringify(call)}`);
      }
      hitter = null;
      call = null;
    }
  }
  return { problems, points, final: snapshot(s) };
}

describe("every point agrees with where the ball landed and who hit it last (task 12)", () => {
  // Found by the sweep below: a late hit from more than COURT.endMargin behind
  // your own baseline was called "out" against you on the same tick, as if
  // the ball you had just hit had flown past the other end.
  it("a late hit from deep behind your own baseline is in play, not called out against you", () => {
    // a fast ball met 5 m behind the baseline (its window reaches 5.8 m),
    // sent back light, so the return's own window is shorter than that
    const s = receiving({ x: 0.5, y: 1, z: -COURT.halfL - 5, vx: 0, vy: 0, vz: -18 }, 0);
    expect(missReason(s, 1)).toBeNull();
    const ev = step(s, [swingAt(s, 1, 0)]);
    expect(outcome(ev, 1)).toBe("hit");
    expect(s.pending).toBeNull();
    let point: TennisEvent | undefined;
    for (let i = 0; i < 300 && !point; i++) point = step(s, []).find((e) => e.type === "point");
    // seat 0 never plays it: it lands in and goes unreturned
    expect(point).toMatchObject({ winner: 1, reason: "unreturned" });
  });

  it("over many seeded matches with a careless swinger: out to the receiver, in and unreturned to the hitter", () => {
    const problems: string[] = [];
    let points = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = refereed(seed, 60 * 90);
      problems.push(...r.problems);
      points += r.points;
    }
    expect(points).toBeGreaterThan(200);
    expect(problems.length, problems.slice(0, 8).join("\n")).toBe(0);
  });

  it("is deterministic: the same seed and inputs give an identical snapshot", () => {
    expect(refereed(3, 60 * 60).final).toEqual(refereed(3, 60 * 60).final);
  });
});
