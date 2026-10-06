export type ClientMsg =
  | { t: "hello"; token?: string }
  | { t: "create"; game: string; practice: boolean }
  | { t: "join"; room: string }
  | { t: "swing"; dirX: number; power: number }
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
    case "swing":
      return typeof m.dirX === "number" && typeof m.power === "number"
        ? { t: "swing", dirX: m.dirX, power: m.power }
        : null;
    case "leave":
      return { t: "leave" };
    default:
      return null;
  }
}
