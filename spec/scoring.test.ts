import { describe, expect, it } from "vitest";
import { createScore, displayScore, fault, pointCalls, pointWon } from "../shared/games/tennis/scoring.ts";
import type { MatchFormat, ScoreState, Side } from "../shared/games/tennis/scoring.ts";

const play = (s: ScoreState, winners: Side[]): ScoreState => winners.reduce(pointWon, s);
const rep = (w: Side, n: number): Side[] => Array<Side>(n).fill(w);
const game = (w: Side): Side[] => rep(w, 4);
const games = (w: Side, n: number): Side[] => Array.from({ length: n }, () => game(w)).flat();
/** Alternate game wins so the set reaches n-n. */
const levelGames = (n: number): Side[] => Array.from({ length: n }, () => [...game(0), ...game(1)]).flat();

describe("game points", () => {
  const cases: Array<[string, Side[], [string, string]]> = [
    ["start", [], ["0", "0"]],
    ["15-0", [0], ["15", "0"]],
    ["30-0", [0, 0], ["30", "0"]],
    ["40-0", [0, 0, 0], ["40", "0"]],
    ["15-30", [0, 1, 1], ["15", "30"]],
    ["40-40", [0, 0, 0, 1, 1, 1], ["40", "40"]],
    ["Ad in", [0, 0, 0, 1, 1, 1, 0], ["Ad", "40"]],
    ["Ad out", [0, 0, 0, 1, 1, 1, 1], ["40", "Ad"]],
    ["back to deuce", [0, 0, 0, 1, 1, 1, 0, 1], ["40", "40"]],
    ["long deuce then Ad", [0, 0, 0, 1, 1, 1, 0, 1, 0, 1, 1], ["40", "Ad"]],
  ];
  it.each(cases)("%s", (_n, pts, calls) => {
    expect(pointCalls(play(createScore("oneSet", 0), pts))).toEqual(calls);
  });

  it("display helper", () => {
    const s = createScore("oneSet", 0);
    expect(displayScore(s)).toBe("0-all");
    expect(displayScore(play(s, [0, 1, 1]))).toBe("15-30");
    expect(displayScore(play(s, [0, 0, 0, 1, 1, 1]))).toBe("Deuce");
    expect(displayScore(play(s, [0, 0, 0, 1, 1, 1, 1]))).toBe("Ad 1");
  });

  it("40-0 wins the game; advantage then point wins; deuce needs two clear", () => {
    expect(play(createScore("oneSet", 0), game(0)).games).toEqual([1, 0]);
    expect(play(createScore("oneSet", 0), [0, 0, 0, 1, 1, 1, 0, 0]).games).toEqual([1, 0]);
    expect(play(createScore("oneSet", 0), [0, 0, 0, 1, 1, 1, 0, 1, 0]).games).toEqual([0, 0]);
  });
});

describe("serve rotation", () => {
  it("alternates every game", () => {
    let s = createScore("oneSet", 1);
    expect(s.server).toBe(1);
    s = play(s, game(0));
    expect(s.server).toBe(0);
    s = play(s, game(1));
    expect(s.server).toBe(1);
  });
  it("server stays during a game", () => {
    expect(play(createScore("oneSet", 0), [1, 1, 0]).server).toBe(0);
  });
});

describe("faults", () => {
  it("one fault keeps the point; two lose it to the receiver", () => {
    let s = fault(createScore("oneSet", 0));
    expect(s.faults).toBe(1);
    expect(s.points).toEqual([0, 0]);
    s = fault(s);
    expect(s.points).toEqual([0, 1]);
    expect(s.faults).toBe(0);
  });
  it("a point resets the fault count", () => {
    const s = pointWon(fault(createScore("oneSet", 0)), 0);
    expect(s.faults).toBe(0);
    expect(fault(s).points).toEqual([1, 0]);
  });
  it("a double fault can lose the game", () => {
    const s = fault(fault(play(createScore("oneSet", 0), rep(1, 3))));
    expect(s.games).toEqual([0, 1]);
  });
});

describe("sets", () => {
  it("6-0 wins the set", () => {
    const s = play(createScore("oneSet", 0), games(0, 6));
    expect(s.winner).toBe(0);
    expect(s.setScores).toEqual([[6, 0]]);
  });
  it("6-5 does not win; 7-5 does", () => {
    let s = play(createScore("oneSet", 0), [...levelGames(5), ...game(0)]);
    expect(s.games).toEqual([6, 5]);
    expect(s.winner).toBeNull();
    s = play(s, game(0));
    expect(s.winner).toBe(0);
    expect(s.setScores).toEqual([[7, 5]]);
  });
  it("ignores points after the match is over", () => {
    const s = play(createScore("oneSet", 0), games(0, 6));
    expect(pointWon(s, 1)).toBe(s);
    expect(fault(s)).toBe(s);
  });
});

describe("tiebreak", () => {
  const toTiebreak = (first: Side): ScoreState => play(createScore("oneSet", first), levelGames(6));
  it("starts at 6-6 with the next server in the rotation", () => {
    const s = toTiebreak(0);
    expect(s.tiebreak).toBe(true);
    expect(s.games).toEqual([6, 6]);
    expect(s.server).toBe(0);
  });
  it("serve changes after 1 point, then every 2", () => {
    let s = toTiebreak(0);
    const servers: Side[] = [];
    for (let i = 0; i < 8; i++) {
      servers.push(s.server);
      s = pointWon(s, (i % 2) as Side);
    }
    expect(servers).toEqual([0, 1, 1, 0, 0, 1, 1, 0]);
  });
  it("first to 7 wins, set 7-6", () => {
    const s = play(toTiebreak(0), rep(1, 7));
    expect(s.winner).toBe(1);
    expect(s.setScores).toEqual([[6, 7]]);
  });
  it("needs a two point margin", () => {
    let s = play(toTiebreak(0), [...rep(0, 6), ...rep(1, 6)]);
    s = play(s, [0]);
    expect(s.points).toEqual([7, 6]);
    expect(s.winner).toBeNull();
    s = play(s, [1, 1]);
    expect(s.points).toEqual([7, 8]);
    expect(s.winner).toBeNull();
    s = play(s, [1]);
    expect(s.winner).toBe(1);
    expect(s.setScores).toEqual([[6, 7]]);
  });
  it("after a tiebreak set, the first receiver serves the next set", () => {
    const b = play(createScore("bestOfThree", 0), [...levelGames(6), ...rep(0, 7)]);
    expect(b.sets).toEqual([1, 0]);
    expect(b.tiebreak).toBe(false);
    expect(b.games).toEqual([0, 0]);
    expect(b.server).toBe(1);
  });
});

describe("match formats", () => {
  const cases: Array<[MatchFormat, string, Side[], Side | null, [number, number]]> = [
    ["oneSet", "one set decides", games(1, 6), 1, [0, 1]],
    ["bestOfThree", "one set is not enough", games(0, 6), null, [1, 0]],
    ["bestOfThree", "2-0", [...games(0, 6), ...games(0, 6)], 0, [2, 0]],
    ["bestOfThree", "1-1 not over", [...games(0, 6), ...games(1, 6)], null, [1, 1]],
    ["bestOfThree", "2-1", [...games(0, 6), ...games(1, 6), ...games(1, 6)], 1, [1, 2]],
  ];
  it.each(cases)("%s: %s", (fmt, _n, pts, winner, sets) => {
    const s = play(createScore(fmt, 0), pts);
    expect(s.winner).toBe(winner);
    expect(s.sets).toEqual(sets);
  });
  it("a new set resets games and keeps alternating the server", () => {
    const s = play(createScore("bestOfThree", 0), games(0, 6));
    expect(s.games).toEqual([0, 0]);
    expect(s.server).toBe(0); // six games: flipped six times
    expect(s.setScores).toEqual([[6, 0]]);
  });
  it("is deterministic and does not mutate its input", () => {
    const a = createScore("oneSet", 0);
    const snap = JSON.stringify(a);
    const pts: Side[] = [0, 1, 0, 0, 1, 0];
    expect(play(a, pts)).toEqual(play(a, pts));
    expect(JSON.stringify(a)).toBe(snap);
  });
});
