import { describe, expect, it } from "vitest";
import { botInputs } from "../shared/games/tennis/bot.ts";
import { asInput, tennis, tennisFrom } from "../shared/games/tennis/index.ts";
import { MAX_REWIND_TICKS, TICK_MS, rewindTicks } from "../server/rewind.ts";
import {
  COURT,
  DT,
  PLAYER,
  CONFIRM_TICKS,
  EITHER_SIDE,
  LEVEL_NAMES,
  STROKES,
  cloneState,
  createState,
  naturalKind,
  predictContact,
  predictLanding,
  snapshot,
  step,
  swingTiming,
  SWING_LEAD_TICKS,
  HIT_WINDOW_S,
  missReason,
  seatZ,
  timingAim,
} from "../shared/games/tennis/sim.ts";
import type { Ball, Level, Seat, SwingKind, TennisInput, TennisSnapshot, TennisState } from "../shared/games/tennis/sim.ts";

function run(s: TennisState, ticks: number, inputsAt: (s: TennisState) => TennisInput[] = () => []): void {
  for (let i = 0; i < ticks; i++) step(s, inputsAt(s));
}

function untilRally(s: TennisState): void {
  while (s.phase === "serve") step(s, []);
}

const swing = (seat: Seat, level: Level, kind: SwingKind = "forehand", dirX = 0): TennisInput => ({
  t: "swing",
  seat,
  dirX,
  kind,
  level,
});

/** Seat 1 is about to receive `ball` (heading -z) and stands at `playerX`. */
function receiving(ball: Ball, playerX: number): TennisState {
  const s = createState(1);
  s.phase = "rally";
  s.lastHitter = 0;
  s.ball = { ...ball };
  s.players[1] = { x: playerX, targetX: playerX };
  return s;
}

/** A ball at seat 1's baseline at height y, on seat 1's forehand (side 1) or backhand (side -1). */
const atBaseline = (y: number, side: 1 | -1 = 1): Ball => ({ x: -0.5 * side, y, z: -COURT.halfL, vx: 0, vy: 0, vz: -1 });

/** A player who moves to where the ball will be and swings whenever it is close. */
function chaser(seat: Seat): (s: TennisState) => TennisInput[] {
  return (s) => {
    const contact = predictContact(s, seat);
    const inputs: TennisInput[] = [{ t: "move", seat, x: contact ? contact.ball.x : s.players[seat].x }];
    if (s.lastHitter !== seat) inputs.push(swing(seat, 1, naturalKind(seat, s.players[seat].x, s.ball.x)));
    return inputs;
  };
}

describe("tennis sim", () => {
  it("is deterministic for the same seed and inputs", () => {
    const a = createState(42);
    const b = createState(42);
    const bots = (s: TennisState) => [...botInputs(s, 0), ...botInputs(s, 1)];
    run(a, 3000, bots);
    run(b, 3000, bots);
    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it("launches the serve toward the receiver after the serve delay", () => {
    const s = createState(1);
    untilRally(s);
    expect(s.phase).toBe("rally");
    expect(s.ball.vz).toBeLessThan(0);
    expect(s.lastHitter).toBe(0);
  });

  it("returns the serve when the receiver gets there and swings", () => {
    const s = createState(7);
    untilRally(s);
    run(s, 200, chaser(1));
    expect(s.lastHitter === 1 || s.score.points[1] > 0).toBe(true);
  });

  it("ignores a swing from the player who just hit", () => {
    const s = createState(3);
    untilRally(s);
    const before = { ...s.ball };
    step(s, [swing(0, 2)]);
    expect(Math.sign(s.ball.vz)).toBe(Math.sign(before.vz));
    expect(s.lastHitter).toBe(0);
  });

  it("awards the point to the server when the receiver never swings", () => {
    const s = createState(5);
    run(s, 600);
    expect(s.score.points[0]).toBeGreaterThanOrEqual(1);
  });

  it("ends the match when the score has a winner and stops stepping the ball", () => {
    const s = createState(9);
    // seat 0 returns everything, seat 1 never swings: seat 0 takes the set
    run(s, 60 * 600, chaser(0));
    expect(s.phase).toBe("over");
    expect(s.winner).not.toBeNull();
    const frozen = snapshot(s).ball;
    run(s, 60);
    expect(snapshot(s).ball).toEqual(frozen);
  });
});

describe("movement and reach", () => {
  it("moves a player toward the target no faster than the speed cap, even during the serve", () => {
    const s = createState(1);
    step(s, [{ t: "move", seat: 0, x: 1000 }]);
    run(s, 29);
    expect(s.phase).toBe("serve");
    expect(s.players[0].x).toBeCloseTo(30 * PLAYER.speed * DT, 9);
    expect(s.players[1].x).toBe(0);
  });

  it("stops at the target and never past the side room", () => {
    const s = createState(1);
    step(s, [
      { t: "move", seat: 0, x: 1000 },
      { t: "move", seat: 1, x: 1.234 },
    ]);
    run(s, 120);
    expect(s.players[0].x).toBe(COURT.halfW + PLAYER.sideRoom);
    expect(s.players[1].x).toBe(1.234);
  });

  it("misses a ball just outside reach and hits one just inside", () => {
    const ball = atBaseline(1);
    // seat 1 stands on the ball's +x side, so it is on their right: forehand
    const far = receiving(ball, ball.x + PLAYER.reach + 0.05);
    step(far, [swing(1, 1, "forehand")]);
    expect(far.lastHitter).toBe(0);

    const near = receiving(ball, ball.x + PLAYER.reach - 0.05);
    step(near, [swing(1, 1, "forehand")]);
    expect(near.lastHitter).toBe(1);
  });

  // Bounces in at about x 2.6 and reaches the baseline about 0.6 s from now.
  const wide: Ball = { x: 1, y: 0.6, z: -4, vx: 3, vy: 1.5, vz: -12 };

  it("a wide shot is unreachable from the far side for a person and the bot alike", () => {
    for (const play of [chaser(1), (s: TennisState) => botInputs(s, 1)]) {
      const s = receiving(wide, -3);
      let touched = false;
      run(s, 120, (st) => {
        touched ||= st.lastHitter === 1;
        return play(st);
      });
      expect(touched).toBe(false);
      expect(s.score.points).toEqual([1, 0]);
    }
  });

  it("the same wide shot is returned from the middle, by a person and the bot alike", () => {
    const person = receiving(wide, 0);
    run(person, 60, chaser(1));
    expect(person.lastHitter).toBe(1);

    const bot = receiving(wide, 0);
    run(bot, 60, (s) => botInputs(s, 1));
    expect(bot.lastHitter).toBe(1);
  });
});

/**
 * Seat 1 hits `ball` at once; follows the shot to its first touchdown.
 * Returns where it landed and how high it was as it crossed the net.
 */
function firstLanding(ball: Ball, playerX: number, input: TennisInput): { z: number; x: number; netY: number | null; net: boolean } {
  const s = receiving(ball, playerX);
  step(s, [input]);
  expect(s.lastHitter).toBe(1);
  let netY: number | null = null;
  for (let i = 0; i < 600; i++) {
    const prevZ = s.ball.z;
    const events = step(s, []);
    if (prevZ <= 0 && s.ball.z > 0) netY = s.ball.y;
    if (events.some((e) => e.type === "point" && e.reason === "net")) return { z: 0, x: s.ball.x, netY, net: true };
    if (s.lastBounce) return { z: s.lastBounce.z, x: s.lastBounce.x, netY, net: false };
  }
  throw new Error("never landed");
}

describe("swing levels: strength sets depth, height is not a control", () => {
  it("each level hits harder than the one below", () => {
    const speeds = ([0, 1, 2] as const).map((level) => {
      const s = receiving(atBaseline(1), 0);
      step(s, [swing(1, level)]);
      return s.ball.vz;
    });
    expect(speeds[0]).toBeGreaterThan(0);
    expect(speeds[1]).toBeGreaterThan(speeds[0]);
    expect(speeds[2]).toBeGreaterThan(speeds[1]);
  });

  // Regression: depth used to depend on contact height (loft + heightGain),
  // so a low ball hit hard went into the net and a high one went long.
  const heights = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5];
  for (const kind of ["forehand", "backhand"] as const) {
    for (const level of [0, 1, 2] as const) {
      it(`${kind} ${LEVEL_NAMES[level]} clears the net and lands in, at its depth, from any contact height`, () => {
        // seat 1's forehand side is -x
        const side = kind === "forehand" ? 1 : -1;
        for (const y of heights) {
          const l = firstLanding(atBaseline(y, side), 0, swing(1, level, kind));
          expect(l.net, `y ${y}`).toBe(false);
          expect(l.netY!, `y ${y}`).toBeGreaterThan(COURT.netH);
          expect(l.z, `y ${y}`).toBeGreaterThan(0);
          expect(l.z, `y ${y}`).toBeLessThanOrEqual(COURT.halfL);
          expect(Math.abs(l.x), `y ${y}`).toBeLessThanOrEqual(COURT.halfW);
          expect(Math.abs(l.z - STROKES[kind][level].depth), `y ${y}`).toBeLessThan(0.5);
        }
      });
    }
  }

  it("lands light short, medium mid-court and hard deep, inside the far half", () => {
    const depth = ([0, 1, 2] as const).map((level) => firstLanding(atBaseline(1), 0, swing(1, level)).z);
    expect(depth[0]).toBeLessThan(depth[1]);
    expect(depth[1]).toBeLessThan(depth[2]);
    expect(depth[2]).toBeLessThan(COURT.halfL);
  });

  it("still clears the net from early or late in the hit window", () => {
    // a 14 m/s ball: the window reaches about 3 m either side of the baseline
    for (const ahead of [-2.8, 2.8]) {
      for (const level of [0, 1, 2] as const) {
        const l = firstLanding({ ...atBaseline(0.5), z: -COURT.halfL + ahead, vz: -14 }, 0, swing(1, level));
        expect(l.net).toBe(false);
        expect(l.z).toBeGreaterThan(0);
        expect(l.z).toBeLessThanOrEqual(COURT.halfL);
      }
    }
  });
});

describe("forehand and backhand", () => {
  it("picks the forehand on the racket side for each seat and hand", () => {
    expect(naturalKind(0, 0, 1)).toBe("forehand");
    expect(naturalKind(1, 0, 1)).toBe("backhand");
    expect(naturalKind(0, 0, 1, "left")).toBe("backhand");
  });

  it("caps backhand hard below forehand hard", () => {
    const fore = receiving(atBaseline(1, 1), 0);
    step(fore, [swing(1, 2, "forehand")]);
    const back = receiving(atBaseline(1, -1), 0);
    step(back, [swing(1, 2, "backhand")]);
    expect(back.ball.vz).toBeLessThan(fore.ball.vz);
  });

  it("a swing that doesn't match the ball's side is a miss: wrong side", () => {
    const matched = receiving(atBaseline(1, -1), 0);
    expect(step(matched, [swing(1, 1, "backhand")])).toContainEqual({ type: "swing", seat: 1, outcome: "hit" });
    for (const [side, kind] of [[-1, "forehand"], [1, "backhand"]] as const) {
      const s = receiving(atBaseline(1, side), 0);
      expect(missReason(s, 1, kind)).toBe("wrong side");
      expect(step(s, [swing(1, 1, kind)])).toContainEqual({ type: "swing", seat: 1, outcome: "wrong side" });
      expect(s.lastHitter).toBe(0);
    }
  });

  it("wrong side follows the hand: a left-hander's forehand is on the other side", () => {
    const s = receiving(atBaseline(1, 1), 0);
    expect(missReason(s, 1, "forehand", "left")).toBe("wrong side");
    expect(missReason(s, 1, "backhand", "left")).toBeNull();
    step(s, [{ ...swing(1, 1, "backhand"), hand: "left" } as TennisInput]);
    expect(s.lastHitter).toBe(1);
  });

  it("a ball straight at you can be taken on either side", () => {
    for (const kind of ["forehand", "backhand"] as const) {
      const s = receiving({ ...atBaseline(1), x: EITHER_SIDE - 0.05 }, 0);
      step(s, [swing(1, 1, kind)]);
      expect(s.lastHitter).toBe(1);
    }
  });
});

describe("predictLanding", () => {
  it("matches where a real hit at the baseline first bounces, and leaves the state alone", () => {
    for (const level of [0, 1, 2] as const) {
      for (const aim of [-1, 0, 0.6]) {
        const s = createState(11);
        untilRally(s);
        const contact = predictContact(s, 1)!;
        s.players[1] = { x: contact.ball.x, targetX: contact.ball.x };
        const before = snapshot(s);
        const predicted = predictLanding(s, 1, aim, level);
        expect(predicted.predicted).toBe(true);
        expect(snapshot(s)).toEqual(before);

        run(s, contact.ticks);
        step(s, [swing(1, level, naturalKind(1, s.players[1].x, s.ball.x), aim)]);
        expect(s.lastHitter).toBe(1);
        s.lastBounce = null;
        while (s.lastBounce === null) step(s, []);
        const landed = s.lastBounce as { x: number; z: number; in: boolean };
        expect(predicted.x).toBeCloseTo(landed.x, 6);
        expect(predicted.z).toBeCloseTo(landed.z, 6);
        expect(predicted.in).toBe(landed.in);
      }
    }
  });

  it("reports a low ball hit hard as in, like any level", () => {
    for (const level of [0, 1, 2] as const) expect(predictLanding(receiving(atBaseline(0.5), 0), 1, 0, level).in).toBe(true);
  });

  it("falls back to aim alone during the serve and while your own shot is travelling", () => {
    const s = createState(1);
    for (const seat of [0, 1] as const) {
      const serve = predictLanding(s, seat, 0, 1);
      expect(serve.predicted).toBe(false);
      expect(serve.in).toBe(true);
    }
    untilRally(s);
    expect(predictContact(s, 0)).toBeNull();
    const away = predictLanding(s, 0, 0, 1);
    expect(away.predicted).toBe(false);
    expect(away.z).toBeLessThan(0);
  });

  it("aim alone follows where you stand and where you point", () => {
    const s = createState(1);
    s.players[0] = { x: -3, targetX: -3 };
    const fromLeft = predictLanding(s, 0, 0, 1);
    s.players[0] = { x: 3, targetX: 3 };
    const fromRight = predictLanding(s, 0, 0, 1);
    expect(fromLeft.x).toBeLessThan(fromRight.x);
    expect(predictLanding(s, 0, -1, 1).x).toBeLessThan(predictLanding(s, 0, 1, 1).x);
  });

  it("uses the grip you hold: a backhand at a forehand-side ball is shown as not in", () => {
    // seat 1's forehand side is -x; this ball is on it
    const s = receiving(atBaseline(1, 1), 0);
    const natural = predictLanding(s, 1, 0, 1);
    expect(predictLanding(s, 1, 0, 1, "right", "forehand")).toEqual(natural);
    expect(natural.in).toBe(true);
    expect(predictLanding(s, 1, 0, 1, "right", "backhand").in).toBe(false);
  });

  it("full aim stays in at light and medium but goes wide at hard: hard is the risky shot", () => {
    const s = receiving(atBaseline(1), 0);
    s.ball.x = 0;
    expect(predictLanding(s, 1, 1, 0).in).toBe(true);
    expect(predictLanding(s, 1, 1, 1).in).toBe(true);
    expect(predictLanding(s, 1, 1, 2).in).toBe(false);
    expect(predictLanding(s, 1, 0.6, 2).in).toBe(true);
  });

  it("moves the landing point with the aim", () => {
    const s = receiving(atBaseline(1), 0);
    const left = predictLanding(s, 1, -1, 1);
    const right = predictLanding(s, 1, 1, 1);
    expect(left.x).toBeLessThan(right.x - 4);
    expect(left.in && right.in).toBe(true);
  });
});

describe("serve", () => {
  it("serves from in front of the server, kept within the middle of the court", () => {
    const s = createState(1);
    step(s, [{ t: "move", seat: 0, x: 1.5 }]);
    untilRally(s);
    expect(s.ball.x).toBe(1.5);

    const wide = createState(1);
    step(wide, [{ t: "move", seat: 0, x: 1000 }]);
    untilRally(wide);
    expect(wide.ball.x).toBeCloseTo(COURT.halfW * 0.6, 9);
  });
});

describe("endless practice", () => {
  it("never ends: a finished match starts a fresh one, and points keep counting", () => {
    const s = createState(9, { endless: true });
    let points = 0;
    let restarts = 0;
    const play = chaser(0);
    for (let i = 0; i < 60 * 600; i++) {
      const before = s.score.sets[0] + s.score.sets[1] + s.score.games[0] + s.score.games[1];
      for (const e of step(s, play(s))) if (e.type === "point") points++;
      const after = s.score.sets[0] + s.score.sets[1] + s.score.games[0] + s.score.games[1];
      if (after < before) restarts++;
    }
    expect(s.phase).not.toBe("over");
    expect(s.winner).toBeNull();
    expect(points).toBeGreaterThan(24);
    expect(restarts).toBeGreaterThan(0);
  });

  it("the adapter makes an endless game only when asked", () => {
    const endless = tennis.create(9, { endless: true });
    const match = tennis.create(9);
    // the bot plays seat 0 and seat 1 never swings, so seat 0 wins every point
    for (let i = 0; i < 60 * 600; i++) {
      endless.step(endless.botInputs(0).map((input) => ({ seat: 0 as const, input })));
      match.step(match.botInputs(0).map((input) => ({ seat: 0 as const, input })));
    }
    expect(endless.finished()).toBeNull();
    expect(match.finished()).not.toBeNull();
  });
});

describe("swing timing", () => {
  it("is early while the ball is on its way, ready as it arrives, and none when nothing is coming", () => {
    const s = createState(7);
    expect(swingTiming(s, 1)).toBe("none");
    untilRally(s);
    expect(swingTiming(s, 0)).toBe("none");
    expect(swingTiming(s, 1)).toBe("early");
    const ticks = predictContact(s, 1)!.ticks;
    run(s, ticks - SWING_LEAD_TICKS);
    expect(swingTiming(s, 1)).toBe("ready");
  });

  it("is ready while the ball is in the hit window past the baseline", () => {
    expect(swingTiming(receiving({ ...atBaseline(1), z: -COURT.halfL - 0.5 }, 0), 1)).toBe("ready");
  });
});

describe("lift (camera follow mode)", () => {
  const landing = (lift?: number) => {
    const s = receiving(atBaseline(1), 0);
    step(s, [{ ...swing(1, 1), lift } as TennisInput]);
    expect(s.lastHitter).toBe(1);
    while (s.phase === "rally" && s.bounces === 0) step(s, []);
    return s.ball.z;
  };

  it("a higher hand lofts the ball deeper, a lower one keeps it shorter; none is the same as 0", () => {
    expect(landing(1)).toBeGreaterThan(landing(0));
    expect(landing(-1)).toBeLessThan(landing(0));
    expect(landing(undefined)).toBe(landing(0));
  });

  it("the adapter clamps lift and rejects a non-number", () => {
    expect(asInput(1, { t: "swing", dirX: 0, kind: "forehand", level: 1, lift: 5 })).toMatchObject({ lift: 1 });
    expect(asInput(1, { t: "swing", dirX: 0, kind: "forehand", level: 1, lift: "high" })).toBeNull();
  });
});

describe("hit window", () => {
  // Regression: the window was a fixed 1.6 m, only 0.09-0.15 s at rally
  // speeds, tighter than a camera swing can be timed, so most camera swings
  // missed while the label said they were sent.
  it("connects a swing 0.2 s before a fast ball reaches the baseline", () => {
    const vz = -18;
    const s = receiving({ x: 0, y: 1, z: -COURT.halfL - vz * 0.2, vx: 0, vy: 0, vz }, 0);
    expect(Math.abs(s.ball.z - seatZ(1))).toBeGreaterThan(COURT.hitWindow);
    step(s, [swing(1, 1)]);
    expect(s.lastHitter).toBe(1);
  });

  it("says why a swing would miss: early, late, out of reach, too high, or no ball", () => {
    const vz = -14;
    const at = (secondsBefore: number, extra: Partial<Ball> = {}) =>
      receiving({ x: 0, y: 1, z: -COURT.halfL - vz * secondsBefore, vx: 0, vy: 0, vz, ...extra }, 0);
    expect(missReason(at(0.1), 1)).toBeNull();
    expect(missReason(at(HIT_WINDOW_S + 0.05), 1)).toBe("early");
    expect(missReason(at(-(HIT_WINDOW_S + 0.05)), 1)).toBe("late");
    expect(missReason(at(0, { x: PLAYER.reach + 0.2 }), 1)).toBe("reach");
    expect(missReason(at(0, { y: PLAYER.maxContactY + 0.2 }), 1)).toBe("high");
    expect(missReason(at(0), 0)).toBe("no ball");
  });

  it("the camera's early cut-off matches the server window, so a swing marked sent can connect", () => {
    expect(SWING_LEAD_TICKS * DT).toBeGreaterThanOrEqual(HIT_WINDOW_S);
    expect(SWING_LEAD_TICKS * DT).toBeLessThan(HIT_WINDOW_S + 0.1);
  });
});

describe("last bounce", () => {
  it("records where the ball touched down, in the snapshot too", () => {
    const s = createState(5);
    untilRally(s);
    while (s.lastBounce === null) step(s, []);
    expect(s.lastBounce.in).toBe(true);
    expect(Math.sign(s.lastBounce.z)).toBe(-1);
    expect(snapshot(s).lastBounce).toEqual(s.lastBounce);
  });

  it("records a wide ball as out, though that bounce ends the point", () => {
    const s = receiving({ ...atBaseline(1), x: 3.5 }, 3.5);
    // seat 1's +dirX is world +x: away out over the sideline
    step(s, [swing(1, 1, naturalKind(1, 3.5, 3.5), 1)]);
    while (s.rally === 0) step(s, []);
    expect(s.lastBounce!.in).toBe(false);
    expect(Math.abs(s.lastBounce!.x)).toBeGreaterThan(COURT.halfW);
  });
});

describe("timing aim", () => {
  const ballAt = (secondsBefore: number) => ({ x: 0, y: 1, z: -COURT.halfL + 14 * secondsBefore, vx: 0, vy: 0, vz: -14 });

  it("on time goes straight; early pulls across the body, late pushes the other way", () => {
    // seat 1 faces +z, so its right is -x
    expect(timingAim(ballAt(0), 1, "forehand", "right")).toBeCloseTo(0, 6);
    // right-hander's early forehand goes to their left (+x for seat 1)
    expect(timingAim(ballAt(0.22), 1, "forehand", "right")).toBeGreaterThan(0.5);
    expect(timingAim(ballAt(-0.22), 1, "forehand", "right")).toBeLessThan(-0.5);
  });

  it("backhand and left hand reverse it, and seat 0 is the mirror of seat 1", () => {
    const early = ballAt(0.15);
    const fh = timingAim(early, 1, "forehand", "right");
    expect(timingAim(early, 1, "backhand", "right")).toBeCloseTo(-fh, 6);
    expect(timingAim(early, 1, "forehand", "left")).toBeCloseTo(-fh, 6);
    const mirrored = { ...early, z: -early.z, vz: -early.vz };
    expect(timingAim(mirrored, 0, "forehand", "right")).toBeCloseTo(-fh, 6);
  });

  it("maps timing to a side for every seat, hand and kind (early pulls across the body)", () => {
    // [seat, hand, kind] -> world sign of an early swing's aim
    const table = [
      [1, "right", "forehand", 1],
      [1, "right", "backhand", -1],
      [1, "left", "forehand", -1],
      [1, "left", "backhand", 1],
      [0, "right", "forehand", -1],
      [0, "right", "backhand", 1],
      [0, "left", "forehand", 1],
      [0, "left", "backhand", -1],
    ] as const;
    for (const [seat, hand, kind, sign] of table) {
      const early = seat === 1 ? ballAt(0.15) : { ...ballAt(0.15), z: COURT.halfL - 14 * 0.15, vz: 14 };
      const late = seat === 1 ? ballAt(-0.15) : { ...ballAt(-0.15), z: COURT.halfL + 14 * 0.15, vz: 14 };
      expect(Math.sign(timingAim(early, seat, kind, hand)), `${seat} ${hand} ${kind}`).toBe(sign);
      expect(Math.sign(timingAim(late, seat, kind, hand)), `${seat} ${hand} ${kind}`).toBe(-sign);
    }
  });

  it("a timing-aimed swing ignores dirX and uses the server's own ball position", () => {
    const early = receiving(ballAt(0.15), 0);
    step(early, [{ ...swing(1, 1, "forehand", -1), timingAim: true } as TennisInput]);
    expect(early.ball.vx).toBeGreaterThan(0);
    expect(asInput(1, { t: "swing", dirX: 0, kind: "forehand", level: 1, timingAim: "yes" })).toBeNull();
  });
});

describe("landing path", () => {
  it("runs from the contact point over the net to the landing spot", () => {
    const l = predictLanding(receiving(atBaseline(1), 0), 1, 0, 1);
    expect(l.path[0].z).toBeCloseTo(-COURT.halfL, 6);
    expect(l.path.at(-1)!.z).toBeCloseTo(l.z, 6);
    for (let i = 1; i < l.path.length; i++) expect(l.path[i].z).toBeGreaterThan(l.path[i - 1].z);
    const atNet = l.path.find((pt) => pt.z > 0)!;
    expect(atNet.y).toBeGreaterThan(COURT.netH);
  });
});

describe("step events", () => {
  it("reports a hit, then the point with its reason and shot count", () => {
    const s = receiving(atBaseline(1), 0);
    s.shots = 1;
    const first = step(s, [swing(1, 1)]);
    expect(first).toContainEqual({ type: "swing", seat: 1, outcome: "hit" });
    expect(s.shots).toBe(2);
    let point: Extract<ReturnType<typeof step>[number], { type: "point" }> | undefined;
    for (let i = 0; i < 600 && !point; i++) point = step(s, []).find((e) => e.type === "point") as typeof point;
    expect(point).toMatchObject({ type: "point", winner: 1, shots: 2 });
    expect(["unreturned", "out"]).toContain(point!.reason);
  });

  it("reports a miss with the same reason missReason gives", () => {
    const s = receiving(atBaseline(1), 3);
    expect(missReason(s, 1)).toBe("reach");
    expect(step(s, [swing(1, 1)])).toContainEqual({ type: "swing", seat: 1, outcome: "reach" });
  });

  it("reports a swing during the serve as no ball, without moving it", () => {
    const s = createState(1);
    expect(step(s, [swing(0, 2)])).toEqual([{ type: "swing", seat: 0, outcome: "no ball" }]);
    expect(s.phase).toBe("serve");
  });

  it("counts the serve as the rally's first shot and resets on the next point", () => {
    const s = createState(1);
    untilRally(s);
    expect(s.shots).toBe(1);
    while (s.phase === "rally") step(s, []);
    expect(s.shots).toBe(0);
  });
});

describe("rewind (ADR 001)", () => {
  // seat 1's swing at the moment a serve from seat 0 reaches seat 1's baseline
  const swing1 = { seat: 1 as const, input: { t: "swing", dirX: 0, kind: "forehand", level: 1 } };

  /** A practice-free game stepped until the serve reaches seat 1's baseline, then `extra` ticks on. */
  function served(extra: number) {
    const g = tennis.create(7);
    const peek = createState(7);
    for (let i = 0; i < 1000; i++) {
      const c = predictContact(peek, 1);
      if (peek.phase === "rally" && c && c.ticks === 0) break;
      // seat 1 stands where the ball will come
      const x = c ? c.ball.x : 0;
      const inputs = [{ seat: 1 as const, input: { t: "move", x } }];
      g.step(inputs);
      step(peek, [{ t: "move", seat: 1, x }]);
    }
    for (let i = 0; i < extra; i++) {
      g.step([]);
      step(peek, []);
    }
    return { g, peek };
  }

  it("a swing that would be late now, but was on time a few ticks ago, hits when rewound", () => {
    // a slow, high ball reaching seat 1, who stands right under it: it stays
    // in play well past the hit window, so "late" really happens
    const start = createState(7);
    start.phase = "rally";
    start.lastHitter = 0;
    start.shots = 1;
    // lands in (task 12: a ball that has landed out is dead, so it must be in)
    start.ball = { x: 0, y: 1.6, z: -COURT.halfL + 6, vx: 0, vy: 0, vz: -8 };
    start.players[1] = { x: 0, targetX: 0 };
    const g = tennisFrom(start);
    const shadow = cloneState(start);
    let onTimeAgo = -1;
    for (let t = 0; t < 120; t++) {
      if (missReason(shadow, 1) === null) onTimeAgo = 0;
      else if (onTimeAgo >= 0) onTimeAgo++;
      if (missReason(shadow, 1) === "late" && onTimeAgo === 3) break;
      g.step([]);
      step(shadow, []);
    }
    // now: too late; 3 ticks ago: in the window
    expect(missReason(shadow, 1)).toBe("late");
    expect(shadow.phase).toBe("rally");
    const events = g.rewind!(swing1, 3);
    expect(events).toContainEqual({ type: "swing", seat: 1, outcome: "hit" });
    const after = g.snapshot() as TennisSnapshot;
    expect(after.lastHitter).toBe(1);
    // replayed to now: same tick, ball already on its way back
    expect(after.tick).toBe(shadow.tick);
    expect(after.ball.vz).toBeGreaterThan(0);
  });

  it("refuses a rewind that would still miss, and leaves the game untouched", () => {
    const { g } = served(0);
    // seat 1 moved away: out of reach at every recent tick
    const before = JSON.stringify(g.snapshot());
    const far = { seat: 1 as const, input: { t: "swing", dirX: 0, kind: "forehand", level: 1 } };
    for (let i = 0; i < 40; i++) g.step([{ seat: 1, input: { t: "move", x: 5 } }]);
    const mid = JSON.stringify(g.snapshot());
    expect(g.rewind!(far, 3)).toBeNull();
    expect(JSON.stringify(g.snapshot())).toBe(mid);
    expect(mid).not.toBe(before);
  });

  it("never rewinds across a point", () => {
    const { g } = served(0);
    // let the ball run on until seat 0 wins the point
    let ticks = 0;
    while ((g.snapshot() as TennisSnapshot).rally === 0 && ticks < 600) {
      g.step([]);
      ticks++;
    }
    expect((g.snapshot() as TennisSnapshot).score.points[0]).toBe(1);
    // reaching back to before the point is refused, however short the gap
    expect(g.rewind!(swing1, 9)).toBeNull();
  });

  it("refuses to look further back than its history", () => {
    const { g } = served(0);
    expect(g.rewind!(swing1, 13)).toBeNull();
    expect(g.rewind!(swing1, 0)).toBeNull();
  });

  it("stays deterministic: a rewound game equals one fed the swing at that tick", () => {
    const back = 5;
    const { g } = served(back);
    expect(g.rewind!(swing1, back)).not.toBeNull();
    // the same game, with the swing applied live at the earlier tick
    const live = tennis.create(7);
    const peek = createState(7);
    let i = 0;
    for (; i < 1000; i++) {
      const c = predictContact(peek, 1);
      if (peek.phase === "rally" && c && c.ticks === 0) break;
      const x = c ? c.ball.x : 0;
      live.step([{ seat: 1, input: { t: "move", x } }]);
      step(peek, [{ t: "move", seat: 1, x }]);
    }
    live.step([swing1]);
    for (let k = 1; k < back; k++) live.step([]);
    expect(g.snapshot()).toEqual(live.snapshot());
  });
});

describe("rewind cap (ADR 001)", () => {
  it("rewinds to the tick on screen when the measured lag covers it", () => {
    // 100 ms round trip + 50 ms margin = 9 ticks allowed; claimed 4 back
    expect(rewindTicks(1000, 996, 100)).toBe(4);
  });

  it("never reaches further back than the measured round trip allows", () => {
    // 20 ms round trip + 50 ms margin = 5 ticks, though 9 were claimed
    expect(rewindTicks(1000, 991, 20)).toBe(5);
  });

  it("never reaches further back than 150 ms, whatever the lag", () => {
    expect(rewindTicks(1000, 900, 2000)).toBe(MAX_REWIND_TICKS);
    expect(MAX_REWIND_TICKS * TICK_MS).toBeCloseTo(150, 0);
  });

  it("gives nothing for unmeasured lag, no claim, or a claim from the future", () => {
    expect(rewindTicks(1000, 995, null)).toBe(0);
    expect(rewindTicks(1000, undefined, 100)).toBe(0);
    expect(rewindTicks(1000, 1005, 100)).toBe(0);
  });
});

describe("pending point (ADR 001: points are final once confirmed)", () => {
  /** A ball heading past seat 1, too high and long to bounce in. */
  function longBall(): TennisState {
    const s = createState(3);
    s.phase = "rally";
    s.lastHitter = 0;
    // a rally shot: a serve landing out would be a fault, not a point
    s.shots = 2;
    s.ball = { x: 0, y: 1.1, z: -COURT.halfL + 8, vx: 0, vy: 2.5, vz: -14 };
    s.players[1] = { x: 0, targetX: 0 };
    return s;
  }

  it("scores an unreturned ball CONFIRM_TICKS after it is decided, not at once", () => {
    const s = longBall();
    let decidedAt = -1;
    let scoredAt = -1;
    for (let t = 0; t < 200 && scoredAt < 0; t++) {
      const e = step(s, []);
      if (decidedAt < 0 && s.pending) decidedAt = s.tick;
      if (e.some((x) => x.type === "point")) scoredAt = s.tick;
    }
    expect(decidedAt).toBeGreaterThan(0);
    expect(scoredAt - decidedAt).toBe(CONFIRM_TICKS);
    // seat 0's shot landed out: seat 1 wins it
    expect(s.score.points).toEqual([0, 1]);
  });

  it("a long ball bouncing out behind the receiver waits, as the receiver could have played it", () => {
    const s = longBall();
    for (let t = 0; t < 200 && !s.lastBounce; t++) step(s, []);
    expect(s.lastBounce?.in).toBe(false);
    expect(s.pending).toMatchObject({ winner: 1, reason: "out" });
    expect(s.score.points).toEqual([0, 0]);
  });

  it("a ball into the net or on the hitter's own side still scores at once", () => {
    const net = createState(3);
    net.phase = "rally";
    net.lastHitter = 0;
    net.ball = { x: 0, y: 0.3, z: 0.1, vx: 0, vy: 0, vz: -14 };
    expect(step(net, [])).toContainEqual(expect.objectContaining({ type: "point", winner: 1, reason: "net" }));
    expect(net.pending).toBeNull();
  });

  it("nothing else can score while a point is pending", () => {
    const s = longBall();
    for (let t = 0; t < 200 && !s.pending; t++) step(s, []);
    const pending = { ...s.pending! };
    const before = [s.score.points[0], s.score.points[1]];
    while (s.tick < pending.atTick - 1) {
      expect(step(s, []).some((e) => e.type === "point")).toBe(false);
    }
    expect([s.score.points[0], s.score.points[1]]).toEqual(before);
  });
});
