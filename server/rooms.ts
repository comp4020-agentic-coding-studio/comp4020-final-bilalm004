import type { WebSocket } from "ws";
import { games } from "../shared/games/registry.ts";
import type { GameInstance } from "../shared/games/registry.ts";
import type { ServerMsg } from "../shared/protocol.ts";
import { recordMatch } from "./db.ts";
import { log } from "./log.ts";

export type Seat = 0 | 1;

export interface Client {
  ws: WebSocket;
  token: string;
  name: string;
  room: Room | null;
  seat: Seat | null;
}

const TICK_MS = 1000 / 60;
const BROADCAST_EVERY = 2;
const SWING_COOLDOWN_TICKS = 15;
const MAX_CATCHUP_TICKS = 5;
const EMPTY_ROOM_TTL_MS = 30_000;
const BOT_SEAT: Seat = 1;
const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

const rooms = new Map<string, Room>();

export function send(c: Client, msg: ServerMsg): void {
  if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
}

class Room {
  id: string;
  gameId: string;
  practice: boolean;
  seats: [Client | null, Client | null] = [null, null];
  spectators = new Set<Client>();
  emptySince: number | null = performance.now();
  private tokens: [string | null, string | null] = [null, null];
  private instance: GameInstance;
  private pending: { seat: Seat; input: unknown }[] = [];
  private lastSwing: [number, number] = [-1000, -1000];
  private ticks = 0;
  private startedAt = performance.now();
  private recorded = false;
  private timer: NodeJS.Timeout;

  constructor(id: string, gameId: string, practice: boolean) {
    this.id = id;
    this.gameId = gameId;
    this.practice = practice;
    this.instance = games[gameId].create((Math.random() * 2 ** 32) >>> 0);
    this.timer = setInterval(() => this.pump(), TICK_MS);
  }

  private clients(): Client[] {
    const seated = this.seats.filter((c): c is Client => c !== null);
    return [...seated, ...this.spectators];
  }

  private ready(): boolean {
    return this.seats[0] !== null && (this.practice || this.seats[1] !== null);
  }

  private broadcast(msg: ServerMsg): void {
    for (const c of this.clients()) send(c, msg);
  }

  private presence(): ServerMsg {
    return {
      t: "presence",
      names: [this.seats[0]?.name ?? null, this.practice ? "Bot" : (this.seats[1]?.name ?? null)],
      spectators: this.spectators.size,
    };
  }

  join(c: Client): void {
    let seat: Seat | null = null;
    if (this.seats[0] === null) seat = 0;
    else if (!this.practice && this.seats[1] === null) seat = 1;
    c.room = this;
    c.seat = seat;
    if (seat === null) this.spectators.add(c);
    else {
      this.seats[seat] = c;
      this.tokens[seat] = c.token;
    }
    this.emptySince = null;
    send(c, { t: "room", room: this.id, game: this.gameId, seat, practice: this.practice });
    send(c, { t: "state", state: this.instance.snapshot() });
    this.broadcast(this.presence());
    log("room_join", { room: this.id, name: c.name, seat });
  }

  leave(c: Client): void {
    if (c.seat !== null && this.seats[c.seat] === c) this.seats[c.seat] = null;
    this.spectators.delete(c);
    log("room_leave", { room: this.id, name: c.name, seat: c.seat });
    c.room = null;
    c.seat = null;
    if (this.clients().length === 0) this.emptySince = performance.now();
    else this.broadcast(this.presence());
  }

  swing(c: Client, dirX: number, power: number): void {
    if (c.seat === null) return;
    if (this.ticks - this.lastSwing[c.seat] < SWING_COOLDOWN_TICKS) return;
    this.lastSwing[c.seat] = this.ticks;
    this.pending.push({ seat: c.seat, input: { dirX, power } });
  }

  isStale(now: number): boolean {
    return this.emptySince !== null && now - this.emptySince > EMPTY_ROOM_TTL_MS;
  }

  destroy(): void {
    clearInterval(this.timer);
    rooms.delete(this.id);
    log("room_destroy", { room: this.id });
  }

  private pump(): void {
    const target = Math.floor((performance.now() - this.startedAt) / TICK_MS);
    let ran = 0;
    while (this.ticks < target && ran < MAX_CATCHUP_TICKS) {
      this.ticks++;
      this.advance();
      ran++;
    }
    if (this.ticks < target) {
      log("tick_drift", { room: this.id, behind: target - this.ticks });
      this.ticks = target;
    }
  }

  private advance(): void {
    if (this.ready()) {
      const inputs = this.pending;
      if (this.practice) {
        const bot = this.instance.botInput(BOT_SEAT);
        if (bot !== null) inputs.push({ seat: BOT_SEAT, input: bot });
      }
      this.instance.step(inputs);
    }
    this.pending = [];
    if (this.ticks % BROADCAST_EVERY === 0) this.broadcast({ t: "state", state: this.instance.snapshot() });

    const result = this.instance.finished();
    if (result && !this.recorded) {
      this.recorded = true;
      recordMatch({ room: this.id, game: this.gameId, tokens: this.tokens, ...result });
      log("match_end", { room: this.id, score: result.score, winner: result.winner });
      this.broadcast({ t: "state", state: this.instance.snapshot() });
    }
  }
}

export function createRoom(gameId: string, practice: boolean): Room | null {
  if (!(gameId in games)) return null;
  let id = "";
  do {
    id = Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join("");
  } while (rooms.has(id));
  const room = new Room(id, gameId, practice);
  rooms.set(id, room);
  log("room_create", { room: id, game: gameId, practice });
  return room;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code.toUpperCase());
}

export function leaveRoom(c: Client): void {
  c.room?.leave(c);
}

export function roomCount(): number {
  return rooms.size;
}

setInterval(() => {
  const now = performance.now();
  for (const room of rooms.values()) if (room.isStale(now)) room.destroy();
}, 10_000).unref();
