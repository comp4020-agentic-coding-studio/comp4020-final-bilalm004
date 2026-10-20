// Archery practice (task 22): endless arrows in the page, levels cycling or
// picked, wind picked or rolled. No room or server.
import { describe, expect, it } from "vitest";
import { ARROWS_PER_LEVEL, PracticeSim } from "../client/games/archery/practice-sim.ts";
import { solveAim } from "../shared/games/archery/bot.ts";
import { STAGES } from "../shared/games/archery/sim.ts";

function shoot(sim: PracticeSim, aim = solveAim(sim.state.distance, sim.state.wind, 1)) {
  sim.release(aim);
  for (let i = 0; i < 1000; i++) {
    const shot = sim.tick();
    if (shot) {
      // let the result show, until the next arrow
      while (sim.state.phase !== "aim") sim.tick();
      return shot;
    }
  }
  throw new Error("never landed");
}

describe("archery practice", () => {
  it("cycles through the levels, a few arrows at each, and round again", () => {
    const sim = new PracticeSim(1);
    const seen: number[] = [];
    for (let i = 0; i < ARROWS_PER_LEVEL * (STAGES.length + 1); i++) {
      seen.push(sim.state.distance);
      shoot(sim);
    }
    expect(seen.slice(0, ARROWS_PER_LEVEL)).toEqual(Array(ARROWS_PER_LEVEL).fill(STAGES[0].distance));
    expect(seen[ARROWS_PER_LEVEL]).toBe(STAGES[1].distance);
    expect(seen.at(-1)).toBe(STAGES[0].distance);
  });

  it("a picked distance and wind stay put, angle included", () => {
    const sim = new PracticeSim(2);
    sim.choose({ level: 6, wind: { speed: 5, angle: Math.PI } });
    for (let i = 0; i < ARROWS_PER_LEVEL * 2; i++) {
      expect(sim.state.distance).toBe(STAGES[6].distance);
      expect(sim.state.wind).toEqual({ speed: 5, angle: Math.PI });
      shoot(sim);
    }
  });

  it("scores the arrows like a match and never ends", () => {
    const sim = new PracticeSim(3);
    const shot = shoot(sim);
    expect(shot.bullseye).toBe(true);
    expect(sim.state.best[0]).toBe(shot.points);
    for (let i = 0; i < 30; i++) shoot(sim, { yaw: 0.3, pitch: 0, draw: 1 });
    expect(sim.state.phase).toBe("aim");
  });

  it("holds still while paused (the camera setup is open)", () => {
    const sim = new PracticeSim(4);
    sim.release({ yaw: 0, pitch: 0.05, draw: 1 });
    sim.paused = true;
    const before = JSON.stringify(sim.state);
    for (let i = 0; i < 100; i++) sim.tick();
    expect(JSON.stringify(sim.state)).toBe(before);
  });
});
