// Schema migrations and what a match row stores (task 1). Runs on a throwaway
// SQLite file, not the app's own database.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { SCHEMA_VERSION, insertMatch, isRated, migrate, schemaVersion } from "../server/schema.ts";
import type { MatchRecord } from "../server/schema.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function freshFile(): string {
  const d = mkdtempSync(join(tmpdir(), "weblympics-db-"));
  dirs.push(d);
  return join(d, "app.db");
}

/** Exactly what server/db.ts created before schema versions existed (v1). */
function makeV1(path: string): void {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
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
  `);
  db.prepare("INSERT INTO players (token, name, created_at) VALUES ('t-a', 'Old Otter', 1)").run();
  db.prepare(
    "INSERT INTO matches (room, game, p0, p1, score0, score1, winner, ended_at) VALUES ('ABCD', 'tennis', 't-a', 't-b', 5, 3, 0, 1000)",
  ).run();
  db.close();
}

const match = (over: Partial<MatchRecord> = {}): MatchRecord => ({
  room: "WXYZ",
  game: "tennis",
  tokens: ["t-a", "t-b"],
  score: [1, 0],
  winner: 0,
  format: "oneSet",
  sets: [[7, 6]],
  practice: false,
  ...over,
});

describe("schema migrations", () => {
  it("opens a database made by the previous schema, keeps its rows and records the new version", () => {
    const path = freshFile();
    makeV1(path);
    const db = new DatabaseSync(path);
    migrate(db);
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(db.prepare("SELECT name FROM players WHERE token = 't-a'").get()).toEqual({ name: "Old Otter" });
    // the old first-to-5 row survives, marked as such and unrated
    expect(db.prepare("SELECT score0, score1, winner, format, sets, practice, rated FROM matches").get()).toEqual({
      score0: 5,
      score1: 3,
      winner: 0,
      format: "points5",
      sets: "[]",
      practice: 0,
      rated: 0,
    });
    // and a new-style row can go in next to it
    insertMatch(db, match());
    expect(db.prepare("SELECT COUNT(*) AS n FROM matches").get()).toEqual({ n: 2 });
    db.close();
  });

  it("creates the current schema on an empty database, and migrating again changes nothing", () => {
    const path = freshFile();
    const db = new DatabaseSync(path);
    migrate(db);
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    insertMatch(db, match());
    migrate(db);
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(db.prepare("SELECT COUNT(*) AS n FROM matches").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM schema_version").get()).toEqual({ n: 1 });
    db.close();
  });

  it("refuses a database from a newer version of the app rather than damage it", () => {
    const db = new DatabaseSync(freshFile());
    migrate(db);
    db.prepare("UPDATE schema_version SET version = ?").run(SCHEMA_VERSION + 1);
    expect(() => migrate(db)).toThrow(/newer/);
    db.close();
  });
});

describe("match rows", () => {
  it("store sets won, each set's games and the format", () => {
    const db = new DatabaseSync(freshFile());
    migrate(db);
    insertMatch(db, match({ score: [2, 1], format: "bestOfThree", sets: [[6, 4], [3, 6], [7, 6]] }));
    const row = db.prepare("SELECT score0, score1, format, sets FROM matches").get() as Record<string, unknown>;
    expect(row).toMatchObject({ score0: 2, score1: 1, format: "bestOfThree" });
    expect(JSON.parse(row.sets as string)).toEqual([
      [6, 4],
      [3, 6],
      [7, 6],
    ]);
    db.close();
  });

  it("practice against the bot is stored but never rated; a match between two people is", () => {
    expect(isRated(match())).toBe(true);
    expect(isRated(match({ practice: true, tokens: ["t-a", null] }))).toBe(false);
    // even with a second token, a practice room is not rated
    expect(isRated(match({ practice: true }))).toBe(false);
    // someone left before the end and their seat had no token
    expect(isRated(match({ tokens: ["t-a", null] }))).toBe(false);

    const db = new DatabaseSync(freshFile());
    migrate(db);
    insertMatch(db, match({ room: "REAL" }));
    insertMatch(db, match({ room: "PRAC", practice: true, tokens: ["t-a", null] }));
    const rows = db.prepare("SELECT room, practice, rated FROM matches ORDER BY id").all();
    expect(rows).toEqual([
      { room: "REAL", practice: 0, rated: 1 },
      { room: "PRAC", practice: 1, rated: 0 },
    ]);
    db.close();
  });
});
