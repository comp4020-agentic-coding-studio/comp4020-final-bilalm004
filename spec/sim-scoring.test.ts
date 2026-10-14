// Task 1: real tennis scoring played through the sim, not the score module
// alone (that is spec/scoring.test.ts). Every point here is a real serve or
// rally stepped tick by tick.
import { describe, expect, it } from "vitest";
import { tennis, tennisFrom } from "../shared/games/tennis/index.ts";
import { COURT, createState, seatZ, snapshot, step } from "../shared/games/tennis/sim.ts";
import type { Seat, TennisEvent, TennisSnapshot, TennisState } from "../shared/games/tennis/sim.ts";

/** Waits for the next serve to leave the racket. */
function toRally(s: TennisState): void {
  for (let i = 0; i < 2000 && s.phase !== "rally"; i++) step(s, []);
}

/** Steps until the serve or rally ends; returns its point or fault event. */
function finish(s: TennisState): TennisEvent {
  for (let i = 0; i < 2000; i++) {
    const e = step(s, []).find((x) => x.type === "point" || x.type === "fault");
    if (e) return e;
  }
  throw new Error("point never ended");
}

/**
 * Plays one real point that `winner` wins. The server wins with a serve the
 * receiver never touches; the receiver wins with a deep return the server
 * never plays.
 */
function playPoint(s: TennisState, winner: Seat): TennisEvent {
  toRally(s);
  if (winner !== s.score.server) {
    // the serve reaches the receiver, who stands right behind it and returns it
    const z = seatZ(winner);
    s.ball = { x: 0, y: 1, z, vx: 0, vy: 0, vz: Math.sign(z) };
    s.players[winner] = { x: 0, targetX: 0 };
    const e = step(s, [{ t: "swing", seat: winner, dirX: 0, kind: "forehand", level: 1 }]);
    expect(e).toContainEqual({ type: "swing", seat: winner, outcome: "hit" });
  }
  return finish(s);
}

/** A serve from `s.score.server` that goes into the net. */
function netServe(s: TennisState): TennisEvent {
  toRally(s);
  const dir = s.score.server === 0 ? -1 : 1;
  s.ball = { x: 0, y: 0.3, z: -dir * 0.1, vx: 0, vy: 0, vz: dir * 13 };
  return finish(s);
}

const run = (s: TennisState, ticks: number) => {
  for (let i = 0; i < ticks; i++) step(s, []);
};

describe("points and games through the sim", () => {
  it("the server serves the whole game; points go 15, 30, 40, game; then the serve changes ends", () => {
    const s = createState(1);
    expect(s.score.server).toBe(0);
    const pts: [number, number][] = [];
    for (let i = 0; i < 3; i++) {
      expect(playPoint(s, 0)).toMatchObject({ type: "point", winner: 0 });
      expect(s.server).toBe(0);
      pts.push([s.score.points[0], s.score.points[1]]);
    }
    expect(pts).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
    playPoint(s, 0);
    expect(s.score.games).toEqual([1, 0]);
    expect(s.score.points).toEqual([0, 0]);
    expect(s.score.server).toBe(1);
    expect(s.server).toBe(1);
    expect(s.phase).toBe("serve");
    expect(s.ball.z).toBe(seatZ(1));
  });

  it("the receiver can win points and break serve", () => {
    const s = createState(1);
    for (let i = 0; i < 4; i++) expect(playPoint(s, 1)).toMatchObject({ type: "point", winner: 1 });
    expect(s.score.games).toEqual([0, 1]);
    expect(s.score.server).toBe(1);
  });

  it("deuce and advantage come from real points", () => {
    const s = createState(1);
    for (const w of [0, 0, 0, 1, 1, 1] as Seat[]) playPoint(s, w);
    expect(s.score.points).toEqual([3, 3]);
    playPoint(s, 1);
    expect(s.score.points).toEqual([3, 4]);
    expect(s.score.games).toEqual([0, 0]);
    playPoint(s, 1);
    expect(s.score.games).toEqual([0, 1]);
  });

  it("records the latest call for the score bar", () => {
    const s = createState(1);
    playPoint(s, 0);
    expect(s.lastCall).toMatchObject({ call: "point", seat: 0, reason: "unreturned" });
    expect(snapshot(s).lastCall).toEqual(s.lastCall);
  });
});

describe("faults and the second serve", () => {
  it("a serve into the net is a fault: second serve from the same end, no point", () => {
    const s = createState(1);
    expect(netServe(s)).toEqual({ type: "fault", server: 0, reason: "net" });
    expect(s.score.faults).toBe(1);
    expect(s.score.points).toEqual([0, 0]);
    expect(s.phase).toBe("serve");
    expect(s.server).toBe(0);
    expect(s.lastCall).toMatchObject({ call: "fault", seat: 0, reason: "net" });
  });

  it("a second fault is a double fault and loses the point; the next point is on first serve", () => {
    const s = createState(1);
    netServe(s);
    expect(netServe(s)).toMatchObject({ type: "point", winner: 1, reason: "double fault" });
    expect(s.score.points).toEqual([0, 1]);
    expect(s.score.faults).toBe(0);
    expect(s.server).toBe(0);
    expect(s.lastCall).toMatchObject({ call: "point", seat: 1, reason: "double fault" });
  });

  it("a fault then a good serve plays the point normally, and the fault is cleared", () => {
    const s = createState(1);
    netServe(s);
    expect(playPoint(s, 0)).toMatchObject({ type: "point", winner: 0 });
    expect(s.score.points).toEqual([1, 0]);
    expect(s.score.faults).toBe(0);
  });

  it("a serve landing out is a fault, not a point", () => {
    const s = createState(1);
    toRally(s);
    // long: over the net and well past seat 1's baseline
    s.ball = { x: 0, y: 2, z: 5, vx: 0, vy: 3, vz: -20 };
    expect(finish(s)).toMatchObject({ type: "fault", server: 0, reason: "out" });
    expect(s.score.points).toEqual([0, 0]);
  });

  it("no lets: a serve that just clears the net cord and lands in is in play", () => {
    const s = createState(1);
    toRally(s);
    s.ball = { x: 0, y: COURT.netH + 0.05, z: 0.2, vx: 0, vy: 0, vz: -10 };
    let call: TennisEvent | undefined;
    for (let i = 0; i < 60 && !call && s.bounces === 0; i++) call = step(s, []).find((e) => e.type !== "swing");
    expect(call).toBeUndefined();
    expect(s.bounces).toBe(1);
    expect(s.lastBounce?.in).toBe(true);
    // unreturned, it is the server's point
    expect(finish(s)).toMatchObject({ type: "point", winner: 0, reason: "unreturned" });
  });

  it("once the serve is returned it's a rally: the server netting later loses a point, not a fault", () => {
    const s = createState(1);
    toRally(s);
    s.shots = 3;
    s.lastHitter = 0;
    s.ball = { x: 0, y: 0.3, z: 0.1, vx: 0, vy: 0, vz: -13 };
    expect(finish(s)).toMatchObject({ type: "point", winner: 1, reason: "net" });
    expect(s.score.points).toEqual([0, 1]);
  });
});

describe("tiebreak, sets and the end of the match", () => {
  it("at 6-6 a tiebreak: the next server in order starts, then two serves each", () => {
    const s = createState(1);
    for (let g = 0; g < 12; g++) {
      const server = s.score.server;
      for (let p = 0; p < 4; p++) playPoint(s, server);
    }
    expect(s.score.games).toEqual([6, 6]);
    expect(s.score.tiebreak).toBe(true);
    const servers: Seat[] = [];
    for (let p = 0; p < 7; p++) {
      servers.push(s.server);
      expect(s.server).toBe(s.score.server);
      playPoint(s, 0);
    }
    // seat 1 served the 12th game, so seat 0 serves the first tiebreak point
    expect(servers).toEqual([0, 1, 1, 0, 0, 1, 1]);
    expect(s.score.setScores).toEqual([[7, 6]]);
    expect(s.phase).toBe("over");
    expect(s.winner).toBe(0);
  });

  it("one set (the default): the match ends with the set and nothing more is played", () => {
    const s = createState(3);
    for (let i = 0; i < 24; i++) playPoint(s, 0);
    expect(s.score.setScores).toEqual([[6, 0]]);
    expect(s.phase).toBe("over");
    expect(s.winner).toBe(0);
    const frozen = snapshot(s);
    run(s, 300);
    expect(snapshot(s).score).toEqual(frozen.score);
    expect(snapshot(s).ball).toEqual(frozen.ball);
    expect(tennisFrom(s).finished()).toEqual({ winner: 0, score: [1, 0], format: "oneSet", sets: [[6, 0]] });
  });

  it("best of three: one set doesn't end it, the second does", () => {
    const s = createState(3, { format: "bestOfThree" });
    for (let i = 0; i < 24; i++) playPoint(s, 0);
    expect(s.score.sets).toEqual([1, 0]);
    expect(s.score.games).toEqual([0, 0]);
    expect(s.phase).toBe("serve");
    for (let i = 0; i < 24; i++) playPoint(s, 0);
    expect(s.score.setScores).toEqual([
      [6, 0],
      [6, 0],
    ]);
    expect(s.phase).toBe("over");
    expect(tennisFrom(s).finished()).toMatchObject({ score: [2, 0], format: "bestOfThree" });
  });

  it("practice never ends: a won match starts a fresh one", () => {
    const s = createState(3, { endless: true });
    for (let i = 0; i < 24; i++) playPoint(s, 0);
    expect(s.phase).toBe("serve");
    expect(s.winner).toBeNull();
    expect(s.score.sets).toEqual([0, 0]);
    expect(s.score.games).toEqual([0, 0]);
    expect(tennisFrom(s).finished()).toBeNull();
  });

  it("the adapter takes the format, defaulting to one set", () => {
    expect((tennis.create(1).snapshot() as TennisSnapshot).score.format).toBe("oneSet");
    expect((tennis.create(1, { format: "bestOfThree" }).snapshot() as TennisSnapshot).score.format).toBe("bestOfThree");
    expect((tennis.create(1, { format: "bogus" }).snapshot() as TennisSnapshot).score.format).toBe("oneSet");
  });

  it("the snapshot carries the score as plain JSON, a copy of the live state", () => {
    const s = createState(1);
    playPoint(s, 0);
    const snap = snapshot(s);
    expect(JSON.parse(JSON.stringify(snap.score))).toEqual(s.score);
    snap.score.points[0] = 99;
    expect(s.score.points[0]).toBe(1);
  });
});

describe("rewind and faults (ADR 001)", () => {
  it("never rewinds across a fault, though a fault leaves the points unchanged", () => {
    // a first serve that seat 1 could play, sailing long behind them
    const start = createState(1);
    start.phase = "rally";
    start.lastHitter = 0;
    start.shots = 1;
    start.ball = { x: 0, y: 1.5, z: -COURT.halfL + 1, vx: 0, vy: 0, vz: -14 };
    const g = tennisFrom(start);
    let ticks = 0;
    let faulted = false;
    while (!faulted && ticks < 200) {
      faulted = g.step([]).some((e) => e.type === "fault");
      ticks++;
    }
    expect(faulted).toBe(true);
    expect((g.snapshot() as TennisSnapshot).score.points).toEqual([0, 0]);
    // decided as it passed the end of the hit window, scored 9 ticks later:
    // 12 ticks back it was still in seat 1's hit window
    const swing = { seat: 1 as const, input: { t: "swing", dirX: 0, kind: "forehand", level: 1 } };
    expect(g.rewind!(swing, 12)).toBeNull();
    expect((g.snapshot() as TennisSnapshot).phase).toBe("serve");
  });

  it("but rewinds a swing at a first serve when nothing has been called since", () => {
    const start = createState(1);
    start.phase = "rally";
    start.lastHitter = 0;
    start.shots = 1;
    start.ball = { x: 0, y: 1.5, z: -COURT.halfL + 1, vx: 0, vy: 0, vz: -14 };
    const g = tennisFrom(start);
    for (let i = 0; i < 6; i++) g.step([]);
    const swing = { seat: 1 as const, input: { t: "swing", dirX: 0, kind: "forehand", level: 1 } };
    expect(g.rewind!(swing, 3)).toContainEqual({ type: "swing", seat: 1, outcome: "hit" });
  });
});
