import { describe, expect, it } from "vitest";
import { botInputs } from "../shared/games/tennis/bot.ts";
import { tennis } from "../shared/games/tennis/index.ts";
import {
  COURT,
  DT,
  PLAYER,
  createState,
  naturalKind,
  predictContact,
  predictLanding,
  snapshot,
  step,
  swingTiming,
  SWING_LEAD_TICKS,
} from "../shared/games/tennis/sim.ts";
import type { Ball, Level, Seat, SwingKind, TennisInput, TennisState } from "../shared/games/tennis/sim.ts";

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

/** Hits the ball at once and runs until the point ends or seat 0 has to play it. */
function outcome(s: TennisState, input: TennisInput): "in" | "fault" {
  step(s, [input]);
  expect(s.lastHitter).toBe(1);
  for (let i = 0; i < 600; i++) {
    if (s.score[1] > 0 || (s.bounces === 1 && s.ball.z > 0)) return "in";
    if (s.score[0] > 0) return "fault";
    step(s, []);
  }
  throw new Error("point never resolved");
}

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
    expect(s.lastHitter === 1 || s.score[1] > 0).toBe(true);
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
    expect(s.score[0]).toBeGreaterThanOrEqual(1);
  });

  it("ends the match at the win score and stops stepping the ball", () => {
    const s = createState(9);
    run(s, 60 * 600);
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
    const far = receiving(ball, ball.x + PLAYER.reach + 0.05);
    step(far, [swing(1, 1, "backhand")]);
    expect(far.lastHitter).toBe(0);

    const near = receiving(ball, ball.x + PLAYER.reach - 0.05);
    step(near, [swing(1, 1, "backhand")]);
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
      expect(s.score).toEqual([1, 0]);
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

describe("swing levels and contact height", () => {
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

  it("a low ball hit hard goes into the net, while light gets it over", () => {
    expect(outcome(receiving(atBaseline(0.5), 0), swing(1, 2))).toBe("fault");
    expect(outcome(receiving(atBaseline(0.5), 0), swing(1, 0))).toBe("in");
  });

  it("a high ball hit hard goes long, while medium keeps it in", () => {
    expect(outcome(receiving(atBaseline(2), 0), swing(1, 2))).toBe("fault");
    expect(outcome(receiving(atBaseline(2), 0), swing(1, 1))).toBe("in");
  });

  it("a ball at a comfortable height can be hit hard", () => {
    expect(outcome(receiving(atBaseline(1.1), 0), swing(1, 2))).toBe("in");
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

  it("backhand hard is steadier: it keeps a high ball in where forehand hard goes long", () => {
    expect(outcome(receiving(atBaseline(1.6, 1), 0), swing(1, 2, "forehand"))).toBe("fault");
    expect(outcome(receiving(atBaseline(1.6, -1), 0), swing(1, 2, "backhand"))).toBe("in");
  });

  it("a swing that doesn't match the ball's side is weaker", () => {
    const matched = receiving(atBaseline(1, -1), 0);
    step(matched, [swing(1, 1, "backhand")]);
    const mismatched = receiving(atBaseline(1, -1), 0);
    step(mismatched, [swing(1, 1, "forehand")]);
    expect(mismatched.lastHitter).toBe(1);
    expect(mismatched.ball.vz).toBeLessThan(matched.ball.vz);
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
        let prev = { ...s.ball };
        while (s.phase === "rally" && s.lastHitter === 1 && s.bounces === 0) {
          prev = { ...s.ball };
          step(s, []);
        }
        const landed = { x: prev.x + prev.vx * DT, z: prev.z + prev.vz * DT };
        expect(predicted.x).toBeCloseTo(landed.x, 6);
        expect(predicted.z).toBeCloseTo(landed.z, 6);
      }
    }
  });

  it("reports a low ball hit hard as not in", () => {
    const landing = predictLanding(receiving(atBaseline(0.5), 0), 1, 0, 2);
    expect(landing.in).toBe(false);
    expect(landing.farSide).toBe(false);
    expect(predictLanding(receiving(atBaseline(0.5), 0), 1, 0, 0).in).toBe(true);
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

  it("uses the grip you hold: a backhand at a forehand-side ball lands shorter", () => {
    // seat 1's forehand side is -x; this ball is on it
    const s = receiving(atBaseline(1, 1), 0);
    const natural = predictLanding(s, 1, 0, 1);
    const held = predictLanding(s, 1, 0, 1, "right", "backhand");
    expect(predictLanding(s, 1, 0, 1, "right", "forehand")).toEqual(natural);
    expect(Math.abs(held.z)).toBeLessThan(Math.abs(natural.z));
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
  it("never ends when there is no win score, and keeps counting points", () => {
    const s = createState(9, null);
    run(s, 60 * 600);
    expect(s.phase).not.toBe("over");
    expect(s.score[0] + s.score[1]).toBeGreaterThan(COURT.winScore * 2);
  });

  it("the adapter makes an endless game only when asked", () => {
    const endless = tennis.create(9, { endless: true });
    const match = tennis.create(9);
    for (let i = 0; i < 60 * 600; i++) {
      endless.step([]);
      match.step([]);
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
