// The SQLite schema and its migrations. Kept apart from db.ts (which opens the
// real file on import) so a test can migrate a database it made itself.
import type { DatabaseSync } from "node:sqlite";

/**
 * Version 1: players, and matches with a first-to-5 point score.
 * Version 2: matches store real tennis results: score0/score1 become sets won,
 * plus the format, each set's games (JSON), whether it was a practice match,
 * and whether it counts towards ratings.
 */
export const SCHEMA_VERSION = 2;

const V1 = `
  CREATE TABLE IF NOT EXISTS players (
    token TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room TEXT NOT NULL,
    game TEXT NOT NULL,
    p0 TEXT,
    p1 TEXT,
    score0 INTEGER NOT NULL,
    score1 INTEGER NOT NULL,
    winner INTEGER NOT NULL,
    ended_at INTEGER NOT NULL
  );
`;

// Version 1 rows keep their old first-to-5 points in score0/score1; format
// 'points5' marks them, and they are not rated (ratings never saw them).
const V2 = `
  ALTER TABLE matches ADD COLUMN format TEXT NOT NULL DEFAULT 'points5';
  ALTER TABLE matches ADD COLUMN sets TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE matches ADD COLUMN practice INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE matches ADD COLUMN rated INTEGER NOT NULL DEFAULT 0;
`;

export function schemaVersion(db: DatabaseSync): number {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = db.prepare("SELECT version FROM schema_version").get() as { version: number } | undefined;
  if (row) return row.version;
  // no version recorded: a database from before the version table is v1 if
  // it has the matches table, otherwise it is empty
  const hasMatches = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'matches'").get();
  const v = hasMatches ? 1 : 0;
  db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(v);
  return v;
}

/** Brings `db` up to SCHEMA_VERSION, one step at a time, each in a transaction. */
export function migrate(db: DatabaseSync): void {
  const steps: Record<number, string> = { 1: V1, 2: V2 };
  let v = schemaVersion(db);
  if (v > SCHEMA_VERSION) throw new Error(`database schema ${v} is newer than this app (${SCHEMA_VERSION})`);
  while (v < SCHEMA_VERSION) {
    v++;
    db.exec("BEGIN");
    try {
      db.exec(steps[v]);
      db.prepare("UPDATE schema_version SET version = ?").run(v);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}

export interface MatchRecord {
  room: string;
  game: string;
  tokens: [string | null, string | null];
  /** Headline result: sets won, in tennis. */
  score: [number, number];
  winner: 0 | 1;
  format: string;
  /** Games in each finished set. */
  sets: Array<[number, number]>;
  practice: boolean;
}

/**
 * Whether a match counts towards ratings. Decided: practice against the bot
 * never does, so a rating can't be farmed off a bot and only reflects people
 * beating people. A match also needs two signed-in players.
 */
export function isRated(m: MatchRecord): boolean {
  return !m.practice && m.tokens[0] !== null && m.tokens[1] !== null;
}

export function insertMatch(db: DatabaseSync, m: MatchRecord, endedAt = Date.now()): void {
  db.prepare(
    `INSERT INTO matches (room, game, p0, p1, score0, score1, winner, ended_at, format, sets, practice, rated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    m.room,
    m.game,
    m.tokens[0],
    m.tokens[1],
    m.score[0],
    m.score[1],
    m.winner,
    endedAt,
    m.format,
    JSON.stringify(m.sets),
    m.practice ? 1 : 0,
    isRated(m) ? 1 : 0,
  );
}
