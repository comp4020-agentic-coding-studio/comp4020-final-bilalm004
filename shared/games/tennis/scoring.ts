// Pure tennis scoring: points, games, sets, tiebreak, serve rotation, faults.
// Deterministic, no I/O. States are immutable: every function returns a new one.

export type Side = 0 | 1;
export type MatchFormat = "oneSet" | "bestOfThree";

export interface ScoreState {
  format: MatchFormat;
  /** Who serves the current point. */
  server: Side;
  /** Points in the current game (or tiebreak). */
  points: [number, number];
  /** Games in the current set. */
  games: [number, number];
  /** Sets won. */
  sets: [number, number];
  /** Finished sets' game scores, in order (a tiebreak set is 7-6). */
  setScores: Array<[number, number]>;
  tiebreak: boolean;
  /** Who served the first point of the current tiebreak (meaningful while tiebreak). */
  tiebreakFirst: Side;
  /** Who serves the first point of the current game (or tiebreak). */
  gameServer: Side;
  /** 0 = on first serve, 1 = first serve was a fault. */
  faults: 0 | 1;
  /** Set when the match is over. */
  winner: Side | null;
}

export const other = (s: Side): Side => (s === 0 ? 1 : 0);

export function createScore(format: MatchFormat, firstServer: Side): ScoreState {
  return {
    format,
    server: firstServer,
    points: [0, 0],
    games: [0, 0],
    sets: [0, 0],
    setScores: [],
    tiebreak: false,
    tiebreakFirst: firstServer,
    gameServer: firstServer,
    faults: 0,
    winner: null,
  };
}

const setsToWin = (f: MatchFormat): number => (f === "oneSet" ? 1 : 2);

/** Server for tiebreak point number n (0-based): one point, then two each. */
function tiebreakServer(first: Side, n: number): Side {
  return Math.floor((n + 1) / 2) % 2 === 0 ? first : other(first);
}

/**
 * The server missed a serve. The first fault allows a second serve; the
 * second consecutive fault loses the point. There are no lets: a serve that
 * clips the net is simply in play or a fault.
 */
export function fault(state: ScoreState): ScoreState {
  if (state.winner !== null) return state;
  if (state.faults === 0) return { ...state, faults: 1 };
  return pointWon(state, other(state.server));
}

/** `winner` won the current point (rally result, or opponent's double fault). */
export function pointWon(state: ScoreState, winner: Side): ScoreState {
  if (state.winner !== null) return state;
  const points: [number, number] = [state.points[0], state.points[1]];
  points[winner]++;
  const s: ScoreState = { ...state, points, faults: 0 };
  const w = points[winner];
  const l = points[other(winner)];

  if (state.tiebreak) {
    if (w >= 7 && w - l >= 2) return endGame(s, winner);
    s.server = tiebreakServer(state.tiebreakFirst, points[0] + points[1]);
    return s;
  }
  if (w >= 4 && w - l >= 2) return endGame(s, winner);
  return s;
}

function endGame(s: ScoreState, winner: Side): ScoreState {
  const games: [number, number] = [s.games[0], s.games[1]];
  games[winner]++;
  const w = games[winner];
  const l = games[other(winner)];
  const setOver = (w >= 6 && w - l >= 2) || w === 7;
  if (!setOver) {
    if (w === 6 && l === 6) {
      // Tiebreak: whoever is next in the serving order serves first.
      const first = other(s.gameServer);
      return { ...s, games, points: [0, 0], tiebreak: true, tiebreakFirst: first, server: first, gameServer: first };
    }
    const next = other(s.gameServer);
    return { ...s, games, points: [0, 0], gameServer: next, server: next };
  }
  const sets: [number, number] = [s.sets[0], s.sets[1]];
  sets[winner]++;
  const setScores = [...s.setScores, games];
  // After a tiebreak the player who received first serves the next set.
  const next = s.tiebreak ? other(s.tiebreakFirst) : other(s.gameServer);
  if (sets[winner] >= setsToWin(s.format)) {
    return { ...s, games, sets, setScores, points: [0, 0], tiebreak: false, winner };
  }
  return { ...s, games: [0, 0], sets, setScores, points: [0, 0], tiebreak: false, gameServer: next, server: next };
}

/** Per-side calls for the current game: "0" "15" "30" "40" "Ad". Tiebreak: raw counts. */
export function pointCalls(state: ScoreState): [string, string] {
  const [a, b] = state.points;
  if (state.tiebreak) return [String(a), String(b)];
  if (a >= 3 && b >= 3) {
    if (a === b) return ["40", "40"];
    return a > b ? ["Ad", "40"] : ["40", "Ad"];
  }
  const calls = ["0", "15", "30", "40"];
  return [calls[Math.min(a, 3)], calls[Math.min(b, 3)]];
}

/** One-line call, e.g. "15-30", "0-all", "Deuce", "Ad 1" (side 1 has advantage). */
export function displayScore(state: ScoreState): string {
  if (state.winner !== null) return "Game, set, match";
  const [a, b] = state.points;
  if (!state.tiebreak && a >= 3 && b >= 3) {
    if (a === b) return "Deuce";
    return `Ad ${a > b ? 0 : 1}`;
  }
  const [ca, cb] = pointCalls(state);
  if (a === b) return `${ca}-all`;
  return `${ca}-${cb}`;
}
