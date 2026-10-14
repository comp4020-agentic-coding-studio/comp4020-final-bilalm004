import type { Hand, Level, MoveMode, SwingKind } from "./games/tennis/sim.ts";

// A room's match format (task 4): the host picks it in the ready panel before
// play. "unlimited" has no winner, counts points and the best rally, is never
// rated, and ends when someone leaves.
export type RoomFormat = "oneSet" | "bestOfThree" | "unlimited";
export const ROOM_FORMATS: readonly RoomFormat[] = ["oneSet", "bestOfThree", "unlimited"];

// waiting (a seat is empty) -> ready-check -> countdown (3 s) -> playing;
// paused while a dropped player's seat is held (30 s)
export type Phase = "waiting" | "ready-check" | "countdown" | "playing" | "paused";

export interface LobbySeat {
  name: string;
  ready: boolean;
  connected: boolean;
  bot: boolean;
}

/** The room's state, owned by the server. */
export interface LobbyView {
  phase: Phase;
  /** A match is under way (it may be paused, or counting down to resume). */
  match: boolean;
  format: RoomFormat;
  /** Seat of the player who picks the format, else null. */
  host: 0 | 1 | null;
  seats: [LobbySeat | null, LobbySeat | null];
  /** Whole seconds left in the countdown, else null. */
  countdown: number | null;
  /** A dropped player's seat being held: whose, and whole seconds left. */
  hold: { seat: 0 | 1; name: string; seconds: number } | null;
  /** Unlimited only: points won by each seat this match, and the longest rally in shots. */
  tally: { points: [number, number]; bestRally: number } | null;
}

export type ClientMsg =
  // demo: sign in as one of the two fixed demo accounts instead of the
  // player identified by `token`; the server decides who that is, never
  // the client
  | { t: "hello"; token?: string; demo?: 1 | 2 }
  // format: the room's starting format ("oneSet" default, "bestOfThree",
  // "unlimited"); an unknown one gets the default. The host can change it in
  // the ready panel before play.
  | { t: "create"; game: string; practice: boolean; format?: string }
  | { t: "join"; room: string }
  // ready-up: the sender's own seat only, before the match
  | { t: "ready"; ready: boolean }
  // the host's match format, before the match; a value not in ROOM_FORMATS is
  // a bad message
  | { t: "format"; format: RoomFormat }
  // lift: hand height at contact in camera follow mode, -1..1 (server clamps)
  // timingAim: aim from how early or late the ball is met instead of dirX
  // tick: the server tick the player's screen showed when they swung; the
  // server judges the swing there if it can (ADR 001), within its own limits
  | { t: "swing"; dirX: number; kind: SwingKind; level: Level; hand?: Hand; lift?: number; timingAim?: boolean; tick?: number }
  | { t: "move"; x: number }
  // movement mode for the sender's own seat: "auto" (the server walks you to
  // the ball, the default) or "tilt" (only your own moves); anything else is
  // a bad message
  | { t: "mode"; mode: MoveMode }
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
  | ({ t: "lobby" } & LobbyView)
  // the room is gone: a dropped player didn't come back in time
  | { t: "closed"; room: string; reason: string }
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
      if (typeof m.game !== "string") return null;
      return { t: "create", game: m.game, practice: m.practice === true, format: typeof m.format === "string" ? m.format : undefined };
    case "join":
      return typeof m.room === "string" ? { t: "join", room: m.room } : null;
    case "ready":
      return typeof m.ready === "boolean" ? { t: "ready", ready: m.ready } : null;
    case "format":
      return (ROOM_FORMATS as readonly unknown[]).includes(m.format) ? { t: "format", format: m.format as RoomFormat } : null;
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
    case "mode":
      return m.mode === "auto" || m.mode === "tilt" ? { t: "mode", mode: m.mode } : null;
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
