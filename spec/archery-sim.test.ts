import { describe, expect, it } from "vitest";
import { botInputs, solveAim } from "../shared/games/archery/bot.ts";
import { archery, asInput } from "../shared/games/archery/index.ts";
import {
  BULLSEYE_POINTS,
  MIN_DRAW,
  RESULT_TICKS,
  SHOT_CLOCK_TICKS,
  STAGES,
  SUDDEN_DEATH,
  TARGET,
  cloneState,
  createState,
  predictHit,
  scoreHit,
  snapshot,
  step,
} from "../shared/games/archery/sim.ts";
import type { Aim, ArcheryEvent, ArcheryInput, ArcheryState, Seat } from "../shared/games/archery/sim.ts";
import { games } from "../shared/games/registry.ts";

const ring = TARGET.radius / 10;

/** Steps until `seat` may shoot (aim phase, their turn), returning the events on the way. */
function toTurn(s: ArcheryState, seat?: Seat): ArcheryEvent[] {
  const ev: ArcheryEvent[] = [];
  for (let i = 0; i < 2000 && !(s.phase === "aim" && (seat === undefined || s.turn === seat)); i++) ev.push(...step(s, []));
  return ev;
}

/** The shooter releases `aim` and the arrow flies until it lands; returns the shot event. */
function shoot(s: ArcheryState, aim: Aim): Extract<ArcheryEvent, { type: "shot" }> {
  const seat = s.turn;
  let ev = step(s, [{ t: "release", seat, ...aim }]);
  for (let i = 0; i < 1000; i++) {
    const shot = ev.find((e) => e.type === "shot");
    if (shot?.type === "shot") return shot;
    ev = step(s, []);
  }
  throw new Error("arrow never landed");
}

/** Whoever's turn it is shoots `aimFor(state)`, until the match is over. */
function playMatch(s: ArcheryState, aimFor: (s: ArcheryState) => Aim): void {
  for (let i = 0; i < 40 && s.phase !== "over"; i++) {
    toTurn(s);
    if ((s.phase as string) === "over") break;
    shoot(s, aimFor(s));
    for (let j = 0; j < RESULT_TICKS + 1 && s.phase === "result"; j++) step(s, []);
  }
}

const perfect = (s: ArcheryState): Aim => solveAim(s.distance, s.wind, 1);
const wide: Aim = { yaw: 0.3, pitch: 0, draw: 1 };

describe("archery scoring", () => {
  it("scores rings 10 to 1 out from the centre, the inner half of the 10 as a bullseye", () => {
    expect(scoreHit({ x: 0, y: 0 })).toEqual({ points: BULLSEYE_POINTS, bullseye: true });
    expect(scoreHit({ x: ring * 0.75, y: 0 })).toEqual({ points: 10, bullseye: false });
    expect(scoreHit({ x: 0, y: ring * 1.5 })).toEqual({ points: 9, bullseye: false });
    expect(scoreHit({ x: ring * 9.5, y: 0 })).toEqual({ points: 1, bullseye: false });
    expect(scoreHit({ x: TARGET.radius + 0.01, y: 0 })).toEqual({ points: 0, bullseye: false });
    expect(scoreHit(null)).toEqual({ points: 0, bullseye: false });
  });
});

describe("archery flight", () => {
  it("a solved aim with no wind lands in the bullseye at every distance", () => {
    for (const { distance } of STAGES) {
      const hit = predictHit(solveAim(distance, { speed: 0, angle: 0 }, 1), distance);
      expect(scoreHit(hit).bullseye).toBe(true);
    }
  });

  it("the server lands where the no-wind preview says when there is no wind", () => {
    const s = createState(7);
    expect(s.wind.speed).toBe(0);
    const aim = { yaw: 0.05, pitch: 0.03, draw: 0.7 };
    const hit = predictHit(aim, s.distance)!;
    shoot(s, aim);
    expect(s.shots[0].hit!.x).toBeCloseTo(hit.x, 9);
    expect(s.shots[0].hit!.y).toBeCloseTo(hit.y, 9);
  });

  it("wind pushes the arrow the way it blows, more at a weaker draw and farther away", () => {
    const right = { speed: 6, angle: 0 };
    const drift = (distance: number, draw: number) => {
      const aim = solveAim(distance, { speed: 0, angle: 0 }, draw);
      return predictHit(aim, distance, right)!.x;
    };
    expect(drift(40, 1)).toBeGreaterThan(0);
    expect(drift(40, 0.4)).toBeGreaterThan(drift(40, 1));
    expect(drift(50, 1)).toBeGreaterThan(drift(20, 1));
    // the preview ignores wind, so at the far stages it misses the gold by rings
    expect(drift(50, 1)).toBeGreaterThan(3 * ring);
  });

  it("a draw below the minimum is not a shot", () => {
    const s = createState(1);
    step(s, [{ t: "release", seat: 0, yaw: 0, pitch: 0, draw: MIN_DRAW / 2 }]);
    expect(s.phase).toBe("aim");
  });

  it("only the seat whose turn it is can aim or shoot", () => {
    const s = createState(1);
    expect(s.turn).toBe(0);
    step(s, [{ t: "release", seat: 1, yaw: 0, pitch: 0, draw: 1 }]);
    expect(s.phase).toBe("aim");
    step(s, [{ t: "aim", seat: 1, yaw: 0.2, pitch: 0.2, draw: 0.5 }]);
    expect(s.aim).toEqual({ yaw: 0, pitch: 0, draw: 0 });
  });

  it("an idle shooter loses the arrow when the shot clock runs out", () => {
    const s = createState(1);
    let ev: ArcheryEvent[] = [];
    for (let i = 0; i < SHOT_CLOCK_TICKS && ev.length === 0; i++) ev = step(s, []);
    expect(ev).toEqual([{ type: "shot", seat: 0, points: 0, bullseye: false, stage: 0, lost: "time" }]);
  });

  it("an arrow that falls short scores nothing", () => {
    const s = createState(1);
    expect(shoot(s, { yaw: 0, pitch: -0.2, draw: 0.2 })).toMatchObject({ points: 0, lost: "short" });
  });
});

describe("archery match", () => {
  it("is eight stages, one arrow each, alternating, the first shooter swapping each stage", () => {
    const s = createState(3);
    const order: Array<[number, Seat]> = [];
    for (let i = 0; i < 16; i++) {
      toTurn(s);
      order.push([s.stage, s.turn]);
      shoot(s, perfect(s));
    }
    expect(order.map(([stage]) => stage)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7]);
    expect(order.map(([, seat]) => seat)).toEqual([0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0]);
  });

  it("stages get farther and windier, the first with no wind; both arrows of a stage share it", () => {
    for (let i = 1; i < STAGES.length; i++) {
      expect(STAGES[i].distance).toBeGreaterThan(STAGES[i - 1].distance);
      expect(STAGES[i].maxWind).toBeGreaterThan(STAGES[i - 1].maxWind);
    }
    expect(STAGES[0].maxWind).toBe(0);
    const s = createState(11);
    for (let stage = 0; stage < STAGES.length; stage++) {
      toTurn(s);
      const wind = { ...s.wind };
      expect(s.distance).toBe(STAGES[stage].distance);
      expect(wind.speed).toBeLessThanOrEqual(STAGES[stage].maxWind);
      shoot(s, perfect(s));
      toTurn(s);
      expect(s.wind).toEqual(wind);
      shoot(s, perfect(s));
    }
  });

  it("the higher total after eight stages wins", () => {
    const s = createState(5);
    playMatch(s, (st) => (st.turn === 0 ? perfect(st) : wide));
    expect(s.phase).toBe("over");
    expect(s.winner).toBe(0);
    expect(s.totals[0]).toBe(8 * BULLSEYE_POINTS);
    expect(s.totals[1]).toBe(0);
    expect(archery.create(1).finished()).toBeNull();
  });

  it("a tie goes to sudden death at the farthest distance, nearer the centre wins", () => {
    const s = createState(9);
    playMatch(s, (st) => (st.stage === SUDDEN_DEATH ? (st.turn === 1 ? perfect(st) : wide) : wide));
    // sudden death decides the winner but is not added to the score
    expect(s.totals).toEqual([0, 0]);
    const last = s.shots.slice(-2);
    expect(last.every((sh) => sh.stage === SUDDEN_DEATH && sh.distance === STAGES.at(-1)!.distance)).toBe(true);
    expect(s.winner).toBe(1);
  });

  it("an exact sudden-death tie shoots again", () => {
    const s = createState(9);
    let rounds = 0;
    playMatch(s, (st) => {
      if (st.stage !== SUDDEN_DEATH) return wide;
      if (st.turnInStage === 0) rounds++;
      return rounds < 3 ? wide : st.turn === 0 ? perfect(st) : wide;
    });
    expect(s.shots.filter((sh) => sh.stage === SUDDEN_DEATH)).toHaveLength(6);
    expect(s.winner).toBe(0);
  });

  it("practice starts a fresh match after one is won", () => {
    const s = createState(5, { endless: true });
    playMatch(s, (st) => (st.turn === 0 ? perfect(st) : wide));
    expect(s.phase).toBe("over");
    toTurn(s);
    expect(s.matches).toBe(1);
    expect(s.shots).toEqual([]);
    expect(s.stage).toBe(0);
  });

  it("unlimited never ends, draws a random level each stage and keeps the best arrow", () => {
    const g = archery.create(4, { format: "unlimited" });
    const s = g.snapshot() as ArcheryState;
    expect(s.format).toBe("unlimited");
    const st = createState(4, { format: "unlimited", endless: true });
    const distances = new Set<number>();
    for (let i = 0; i < 40; i++) {
      toTurn(st);
      distances.add(st.distance);
      shoot(st, i === 3 ? perfect(st) : wide);
    }
    expect(st.phase).not.toBe("over");
    expect(distances.size).toBeGreaterThan(3);
    expect(Math.max(...st.best)).toBe(BULLSEYE_POINTS);
  });
});

describe("archery determinism and adapter", () => {
  it("the same seed and inputs give the same game", () => {
    const play = () => {
      const s = createState(42);
      const log: unknown[] = [];
      for (let i = 0; i < 3000; i++) log.push(...step(s, botInputs(s, s.turn)));
      return { log, snap: snapshot(s) };
    };
    expect(play()).toEqual(play());
  });

  it("asking the bot never changes the game", () => {
    const s = createState(8);
    toTurn(s);
    const before = cloneState(s);
    botInputs(s, 0);
    botInputs(s, 1);
    expect(s).toEqual(before);
  });

  it("the bot shoots on its turn only, and hits the target near and far", () => {
    const s = createState(2);
    expect(botInputs(s, 1)).toEqual([]);
    for (let i = 0; i < 4000 && s.phase !== "over"; i++) step(s, [...botInputs(s, 0), ...botInputs(s, 1)]);
    expect(s.phase).toBe("over");
    const hits = s.shots.filter((sh) => sh.points > 0);
    expect(hits.length).toBeGreaterThanOrEqual(14);
    // it is beatable: not every arrow is gold
    expect(s.shots.filter((sh) => sh.points >= 10).length).toBeLessThan(s.shots.length);
  });

  it("validates input: the seat is the connection's, junk is dropped", () => {
    expect(asInput(1, { t: "release", seat: 0, yaw: 0.1, pitch: 0.1, draw: 1 })).toEqual({ t: "release", seat: 1, yaw: 0.1, pitch: 0.1, draw: 1 });
    expect(asInput(0, { t: "release", yaw: "x", pitch: 0, draw: 1 })).toBeNull();
    expect(asInput(0, { t: "release", yaw: Infinity, pitch: 0, draw: 1 })).toBeNull();
    expect(asInput(0, { t: "swing", dirX: 0 })).toBeNull();
    const input: ArcheryInput = { t: "aim", seat: 0, yaw: 9, pitch: 9, draw: 9 };
    const s = createState(1);
    step(s, [input]);
    expect(s.aim.draw).toBe(1);
    expect(Math.abs(s.aim.yaw)).toBeLessThan(1);
  });

  it("is registered, and tennis still is", () => {
    expect(games.archery.name).toBe("Archery");
    expect(games.tennis).toBeDefined();
  });
});
