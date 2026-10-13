import type { Hand, Level, SwingKind } from "./games/tennis/sim.ts";

export type ClientMsg =
  // demo: sign in as one of the two fixed demo accounts instead of the
  // player identified by `token`; the server decides who that is, never
  // the client
  | { t: "hello"; token?: string; demo?: 1 | 2 }
  | { t: "create"; game: string; practice: boolean }
  | { t: "join"; room: string }
  // lift: hand height at contact in camera follow mode, -1..1 (server clamps)
  // timingAim: aim from how early or late the ball is met instead of dirX
  // tick: the server tick the player's screen showed when they swung; the
  // server judges the swing there if it can (ADR 001), within its own limits
  | { t: "swing"; dirX: number; kind: SwingKind; level: Level; hand?: Hand; lift?: number; timingAim?: boolean; tick?: number }
  | { t: "move"; x: number }
  // practice only: hold the game while the player sets up the camera
  | { t: "pause"; paused: boolean }
  // reply to the server's ping, echoing its id, so it can time the round trip
  | { t: "pong"; id: number }
  | { t: "leave" };

export interface RoomInfo {
  room: string;
  game: string;
  seat: 0 | 1 | null;
  practice: boolean;
}

export type ServerMsg =
  | { t: "welcome"; token: string; name: string; matches: number }
  | ({ t: "room" } & RoomInfo)
  | { t: "presence"; names: [string | null, string | null]; spectators: number }
  | { t: "state"; state: unknown }
  | { t: "ping"; id: number }
  // the server's ruling on your swing: hit, or why it missed
  // allowed: ticks back the server would judge it; rewind: ticks back it did
  | { t: "swing"; tick: number; outcome: string; rtt: number | null; allowed: number; rewind: number }
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
      return {
        t: "hello",
        token: typeof m.token === "string" ? m.token : undefined,
        demo: m.demo === 1 || m.demo === 2 ? m.demo : undefined,
      };
    case "create":
      return typeof m.game === "string" ? { t: "create", game: m.game, practice: m.practice === true } : null;
    case "join":
      return typeof m.room === "string" ? { t: "join", room: m.room } : null;
    case "swing": {
      const { dirX, kind, level, hand, lift, timingAim, tick } = m;
      if (typeof dirX !== "number" || !Number.isFinite(dirX)) return null;
      if (level !== 0 && level !== 1 && level !== 2) return null;
      if (kind !== "forehand" && kind !== "backhand") return null;
      if (hand !== undefined && hand !== "right" && hand !== "left") return null;
      if (lift !== undefined && (typeof lift !== "number" || !Number.isFinite(lift))) return null;
      if (timingAim !== undefined && typeof timingAim !== "boolean") return null;
      if (tick !== undefined && !Number.isSafeInteger(tick)) return null;
      return { t: "swing", dirX, kind, level, hand, lift, timingAim, tick: tick as number | undefined };
    }
    case "move":
      return typeof m.x === "number" && Number.isFinite(m.x) ? { t: "move", x: m.x } : null;
    case "pause":
      return typeof m.paused === "boolean" ? { t: "pause", paused: m.paused } : null;
    case "pong":
      return Number.isInteger(m.id) ? { t: "pong", id: m.id as number } : null;
    case "leave":
      return { t: "leave" };
    default:
      return null;
  }
}
