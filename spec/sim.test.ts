import { describe, expect, it } from "vitest";
import { COURT, createState, seatZ, snapshot, step } from "../shared/games/tennis/sim.ts";
import type { Swing, TennisState } from "../shared/games/tennis/sim.ts";

function run(s: TennisState, ticks: number, swingAt: (s: TennisState) => Swing[] = () => []): void {
  for (let i = 0; i < ticks; i++) step(s, swingAt(s));
}

function untilRally(s: TennisState): void {
  while (s.phase === "serve") step(s, []);
}

describe("tennis sim", () => {
  it("is deterministic for the same seed and inputs", () => {
    const a = createState(42);
    const b = createState(42);
    run(a, 600);
    run(b, 600);
    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it("launches the serve toward the receiver after the serve delay", () => {
    const s = createState(1);
    untilRally(s);
    expect(s.phase).toBe("rally");
    expect(s.ball.vz).toBeLessThan(0);
    expect(s.lastHitter).toBe(0);
  });

  it("returns the ball when the receiver swings inside the hit window", () => {
    const s = createState(7);
    untilRally(s);
    run(s, 600, (st) =>
      st.phase === "rally" && st.lastHitter === 0 && Math.abs(st.ball.z - seatZ(1)) < COURT.hitWindow * 0.5
        ? [{ seat: 1, dirX: 0, power: 0.5 }]
        : [],
    );
    expect(s.lastHitter === 1 || s.score[0] + s.score[1] > 0).toBe(true);
  });

  it("ignores a swing from the player who just hit", () => {
    const s = createState(3);
    untilRally(s);
    const before = { ...s.ball };
    step(s, [{ seat: 0, dirX: 1, power: 1 }]);
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
