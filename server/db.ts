import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const dir = process.env.DATA_DIR ?? (existsSync("/data") ? "/data" : "./data");
mkdirSync(dir, { recursive: true });

const db = new DatabaseSync(join(dir, "app.db"));
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

const ADJECTIVES = ["Swift", "Lucky", "Quiet", "Brave", "Sunny", "Nimble", "Plucky", "Breezy"];
const ANIMALS = ["Otter", "Heron", "Wombat", "Koala", "Magpie", "Quokka", "Gecko", "Dingo"];
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

export interface Player {
  token: string;
  name: string;
}

// Two fixed, public accounts: anyone can sign in as one, from any device, so
// a stranger can prove their match actually persisted without relying on
// this browser's storage. Seeded once; `INSERT OR IGNORE` makes this safe to
// run on every boot.
const DEMO_PLAYERS: Record<1 | 2, Player> = {
  1: { token: "demo-1", name: "Demo One" },
  2: { token: "demo-2", name: "Demo Two" },
};
for (const { token, name } of Object.values(DEMO_PLAYERS)) {
  db.prepare("INSERT OR IGNORE INTO players (token, name, created_at) VALUES (?, ?, 0)").run(token, name);
}

export function getDemoPlayer(n: 1 | 2): Player {
  return DEMO_PLAYERS[n];
}

export function getOrCreatePlayer(token: string | undefined): Player {
  if (token && token.length <= 64) {
    const row = db.prepare("SELECT name FROM players WHERE token = ?").get(token) as { name: string } | undefined;
    if (row) return { token, name: row.name };
  }
  const fresh = randomUUID();
  const name = `${pick(ADJECTIVES)} ${pick(ANIMALS)} ${10 + Math.floor(Math.random() * 90)}`;
  db.prepare("INSERT INTO players (token, name, created_at) VALUES (?, ?, ?)").run(fresh, name, Date.now());
  return { token: fresh, name };
}

export interface MatchRecord {
  room: string;
  game: string;
  tokens: [string | null, string | null];
  score: [number, number];
  winner: 0 | 1;
}

export function recordMatch(m: MatchRecord): void {
  db.prepare(
    "INSERT INTO matches (room, game, p0, p1, score0, score1, winner, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(m.room, m.game, m.tokens[0], m.tokens[1], m.score[0], m.score[1], m.winner, Date.now());
}

export function matchCountFor(token: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM matches WHERE p0 = ? OR p1 = ?").get(token, token) as { n: number }).n;
}
