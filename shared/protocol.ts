import type { Hand, Level, SwingKind } from "./games/tennis/sim.ts";

export type ClientMsg =
  | { t: "hello"; token?: string }
  | { t: "create"; game: string; practice: boolean }
  | { t: "join"; room: string }
  | { t: "swing"; dirX: number; kind: SwingKind; level: Level; hand?: Hand }
  | { t: "move"; x: number }
  // practice only: hold the game while the player sets up the camera
  | { t: "pause"; paused: boolean }
  | { t: "leave" };

export interface RoomInfo {
  room: string;
  game: string;
  seat: 0 | 1 | null;
  practice: boolean;
}

export type ServerMsg =
  | { t: "welcome"; token: string; name: string }
  | ({ t: "room" } & RoomInfo)
  | { t: "presence"; names: [string | null, string | null]; spectators: number }
  | { t: "state"; state: unknown }
  | { t: "error"; message: string };

export function parseClientMsg(raw: string): ClientMsg | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const m = v as Record<string, unknown>;
  switch (m.t) {
    case "hello":
      return { t: "hello", token: typeof m.token === "string" ? m.token : undefined };
    case "create":
      return typeof m.game === "string" ? { t: "create", game: m.game, practice: m.practice === true } : null;
    case "join":
      return typeof m.room === "string" ? { t: "join", room: m.room } : null;
    case "swing": {
      const { dirX, kind, level, hand } = m;
      if (typeof dirX !== "number" || !Number.isFinite(dirX)) return null;
      if (level !== 0 && level !== 1 && level !== 2) return null;
      if (kind !== "forehand" && kind !== "backhand") return null;
      if (hand !== undefined && hand !== "right" && hand !== "left") return null;
      return { t: "swing", dirX, kind, level, hand };
    }
    case "move":
      return typeof m.x === "number" && Number.isFinite(m.x) ? { t: "move", x: m.x } : null;
    case "pause":
      return typeof m.paused === "boolean" ? { t: "pause", paused: m.paused } : null;
    case "leave":
      return { t: "leave" };
    default:
      return null;
  }
}
