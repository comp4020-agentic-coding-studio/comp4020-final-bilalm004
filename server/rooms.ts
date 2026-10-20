// The live rooms, made with the real clock, database and log. The rules of a
// room are in room.ts (sockets and game) and lobby.ts (phases, seats, holds).
import { games } from "../shared/games/registry.ts";
import { ROOM_FORMATS } from "../shared/protocol.ts";
import type { RoomFormat } from "../shared/protocol.ts";
import { recordMatch } from "./db.ts";
import { log } from "./log.ts";
import { Room, send } from "./room.ts";
import type { Client } from "./room.ts";

export { send } from "./room.ts";
export type { Client, Seat } from "./room.ts";

export const PING_MS = 2000;
// weight of the newest sample in the smoothed round trip
const RTT_SMOOTHING = 0.25;
const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

export function sendPing(c: Client): void {
  const id = ++c.pings;
  c.outstanding = { id, sentAt: performance.now() };
  send(c, { t: "ping", id });
}

/** Only a pong for the outstanding ping counts; a stale or repeated one is ignored. */
export function onPong(c: Client, id: number): void {
  if (c.outstanding?.id !== id) return;
  const sample = performance.now() - c.outstanding.sentAt;
  c.outstanding = null;
  c.rtt = c.rtt === null ? sample : c.rtt + (sample - c.rtt) * RTT_SMOOTHING;
}

const rooms = new Map<string, Room>();

/** A format `gameId` offers, or its default (the first) for anything else. */
export function asRoomFormat(format: unknown, gameId = "tennis"): RoomFormat {
  const offered = games[gameId]?.formats ?? ROOM_FORMATS;
  return (offered as readonly unknown[]).includes(format) ? (format as RoomFormat) : offered[0];
}

export function createRoom(gameId: string, practice: boolean, format?: string): Room | null {
  if (!(gameId in games)) return null;
  let id = "";
  do {
    id = Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join("");
  } while (rooms.has(id));
  const room = new Room(id, gameId, practice, asRoomFormat(format, gameId), {
    record: recordMatch,
    clock: () => performance.now(),
    log,
    timer: true,
    timing: {},
    onDestroy: (r) => rooms.delete(r.id),
  });
  rooms.set(id, room);
  log("room_create", { room: id, game: gameId, practice, format: room.lobby.format });
  return room;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code.toUpperCase());
}

/** `dropped`: the connection closed, rather than the player pressing Leave. */
export function leaveRoom(c: Client, dropped = false): void {
  c.room?.leave(c, dropped);
}

export function roomCount(): number {
  return rooms.size;
}

setInterval(() => {
  const now = performance.now();
  for (const room of rooms.values()) if (room.isStale(now)) room.destroy();
}, 10_000).unref();
