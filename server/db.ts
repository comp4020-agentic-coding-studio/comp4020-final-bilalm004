import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { insertMatch, migrate } from "./schema.ts";
import type { MatchRecord } from "./schema.ts";

export type { MatchRecord } from "./schema.ts";

const dir = process.env.DATA_DIR ?? (existsSync("/data") ? "/data" : "./data");
mkdirSync(dir, { recursive: true });

const db = new DatabaseSync(join(dir, "app.db"));
db.exec("PRAGMA journal_mode = WAL;");
migrate(db);

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

export function recordMatch(m: MatchRecord): void {
  insertMatch(db, m);
}

export function matchCountFor(token: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM matches WHERE p0 = ? OR p1 = ?").get(token, token) as { n: number }).n;
}
