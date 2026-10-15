// One room: seats, spectators, the game and its 60 Hz loop, driven by the
// room's rules in lobby.ts. No database here: the result goes to `record`, so
// a test can build a room with a fake clock and fake sockets
// (spec/room-rules.test.ts). rooms.ts creates rooms with the real ones.
import type { WebSocket } from "ws";
import { games } from "../shared/games/registry.ts";
import type { GameEvent, GameInstance } from "../shared/games/registry.ts";
import type { ClientMsg, LobbyView, RoomFormat, ServerMsg } from "../shared/protocol.ts";
import { Lobby } from "./lobby.ts";
import type { Timing } from "./lobby.ts";
import { log as realLog } from "./log.ts";
import { TICK_MS, rewindTicks } from "./rewind.ts";
import type { MatchRecord } from "./schema.ts";

export type Seat = 0 | 1;

export interface Client {
  ws: Pick<WebSocket, "readyState" | "send">;
  token: string;
  name: string;
  room: Room | null;
  seat: Seat | null;
  // smoothed round trip in ms, from app-level pings; null until the first pong
  rtt: number | null;
  pings: number;
  // the ping still waiting for its pong
  outstanding: { id: number; sentAt: number } | null;
}

export function send(c: Client, msg: ServerMsg): void {
  if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
}

export interface RoomDeps {
  record(m: MatchRecord): void;
  /** ms, monotonic */
  clock(): number;
  log(event: string, fields?: Record<string, unknown>): void;
  /** Runs its own 60 Hz timer; a test leaves it off and calls pump(). */
  timer: boolean;
  timing: Partial<Timing>;
  onDestroy(room: Room): void;
}

const BROADCAST_EVERY = 2;
const SWING_COOLDOWN_TICKS = 15;
// Clients send a move target about 20-30 times a second; more than this is dropped.
const MOVES_PER_SECOND = 40;
const MAX_CATCHUP_TICKS = 5;
const EMPTY_ROOM_TTL_MS = 30_000;
const BOT_SEAT: Seat = 1;

export class Room {
  id: string;
  gameId: string;
  practice: boolean;
  seats: [Client | null, Client | null] = [null, null];
  spectators = new Set<Client>();
  emptySince: number | null;
  readonly lobby: Lobby;
  private deps: RoomDeps;
  private instance: GameInstance;
  private pending: { seat: Seat; input: unknown }[] = [];
  private lastSwing: [number, number] = [-1000, -1000];
  // latest move target per seat, applied once on the next tick
  private pendingMove: [number | null, number | null] = [null, null];
  // a seat's wanted movement mode, kept until the game next steps (so one
  // sent while waiting for an opponent or paused isn't lost)
  private pendingMode: [string | null, string | null] = [null, null];
  private moveWindow: [{ start: number; count: number }, { start: number; count: number }] = [
    { start: 0, count: 0 },
    { start: 0, count: 0 },
  ];
  private ticks = 0;
  // ticks the game itself has stepped, which is what clients see and claim
  private simTick = 0;
  // how far back each seat's latest swing was allowed to be judged, for the log
  private allowed: [number, number] = [0, 0];
  // practice only: the player holds the game while setting up the camera
  private paused = false;
  private startedAt: number;
  private recorded = false;
  // unlimited: points won and the longest rally this match
  private tally = { points: [0, 0] as [number, number], bestRally: 0 };
  private lastLobby = "";
  private timer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(id: string, gameId: string, practice: boolean, format: RoomFormat, deps: RoomDeps) {
    this.id = id;
    this.gameId = gameId;
    this.practice = practice;
    this.deps = deps;
    this.lobby = new Lobby(practice, format, deps.timing);
    this.startedAt = deps.clock();
    this.emptySince = deps.clock();
    this.instance = this.newGame();
    if (deps.timer) this.timer = setInterval(() => this.pump(), TICK_MS);
  }

  /**
   * A fresh game for the room's format. Practice and unlimited never end (a
   * won set starts a new one); unlimited scores like one set but nobody wins.
   */
  private newGame(): GameInstance {
    const unlimited = this.lobby.format === "unlimited";
    const seed = (Math.random() * 2 ** 32) >>> 0;
    this.recorded = false;
    this.tally = { points: [0, 0], bestRally: 0 };
    return games[this.gameId].create(seed, { endless: this.practice || unlimited, format: unlimited ? "oneSet" : this.lobby.format });
  }

  private clients(): Client[] {
    const seated = this.seats.filter((c): c is Client => c !== null);
    return [...seated, ...this.spectators];
  }

  private playing(): boolean {
    return this.lobby.phase() === "playing" && !this.paused;
  }

  private broadcast(msg: ServerMsg): void {
    for (const c of this.clients()) send(c, msg);
  }

  private presence(): ServerMsg {
    return { t: "presence", names: [this.lobby.name(0), this.lobby.name(1)], spectators: this.spectators.size };
  }

  lobbyView(): LobbyView {
    const tally = this.lobby.format === "unlimited" && !this.practice ? { points: [...this.tally.points] as [number, number], bestRally: this.tally.bestRally } : null;
    return { ...this.lobby.view(this.deps.clock()), tally };
  }

  /** Sends the room's state to everyone if it changed (seconds count down, too). */
  private syncLobby(force = false): void {
    const view = this.lobbyView();
    const key = JSON.stringify(view);
    if (!force && key === this.lastLobby) return;
    this.lastLobby = key;
    this.broadcast({ t: "lobby", ...view });
  }

  join(c: Client): void {
    const now = this.deps.clock();
    const seat = this.lobby.seatFor(c.token);
    c.room = this;
    c.seat = seat;
    if (seat === null) this.spectators.add(c);
    else {
      const reclaimed = this.lobby.sit(seat, c.token, c.name, now);
      this.seats[seat] = c;
      // a new occupant starts in the default; their own mode message follows
      this.pendingMode[seat] = "auto";
      if (reclaimed) this.deps.log("seat_reclaim", { room: this.id, name: c.name, seat });
    }
    this.emptySince = null;
    send(c, { t: "room", room: this.id, game: this.gameId, seat, practice: this.practice });
    send(c, { t: "state", state: this.instance.snapshot() });
    this.broadcast(this.presence());
    this.syncLobby(true);
    this.deps.log("room_join", { room: this.id, name: c.name, seat });
  }

  /** `dropped`: the connection went, rather than the player choosing to leave. */
  leave(c: Client, dropped = false): void {
    const now = this.deps.clock();
    if (c.seat !== null && this.seats[c.seat] === c) {
      const seat = c.seat;
      this.seats[seat] = null;
      const unlimitedOver = this.lobby.inMatch && this.lobby.format === "unlimited" && !this.practice;
      const tokens = this.seatTokens();
      const result = this.lobby.leave(seat, now, dropped);
      if (this.practice) this.paused = false;
      if (result === "held") this.deps.log("seat_hold", { room: this.id, name: c.name, seat });
      if (result === "ended") {
        // nobody waits for someone who chose to go: no result, except that
        // unlimited ends this way and keeps its (unrated) tally
        if (unlimitedOver) this.recordUnlimited(tokens);
        this.deps.log("match_abandon", { room: this.id, name: c.name, seat });
        this.instance = this.newGame();
        this.broadcast({ t: "state", state: this.instance.snapshot() });
      }
    }
    this.spectators.delete(c);
    this.deps.log("room_leave", { room: this.id, name: c.name, seat: c.seat, dropped });
    c.room = null;
    c.seat = null;
    if (this.clients().length === 0) this.emptySince = now;
    else {
      this.broadcast(this.presence());
      this.syncLobby(true);
    }
  }

  ready(c: Client, ready: boolean): void {
    if (c.seat === null || this.seats[c.seat] !== c) return;
    if (this.lobby.setReady(c.seat, ready, this.deps.clock())) {
      this.deps.log("ready", { room: this.id, seat: c.seat, ready });
      this.syncLobby();
    }
  }

  format(c: Client, format: RoomFormat): string | null {
    if (c.seat === null || this.seats[c.seat] !== c) return "only the host can change the format";
    const r = this.lobby.setFormat(c.seat, format, this.deps.clock());
    if (r === "not host") return "only the host can change the format";
    if (r === "started") return "the match has started";
    if (r === "ok") {
      this.instance = this.newGame();
      this.deps.log("format", { room: this.id, format });
      this.broadcast({ t: "state", state: this.instance.snapshot() });
      this.syncLobby();
    }
    return null;
  }

  swing(c: Client, msg: Extract<ClientMsg, { t: "swing" }>): void {
    if (c.seat === null) return;
    if (this.ticks - this.lastSwing[c.seat] < SWING_COOLDOWN_TICKS) return;
    this.lastSwing[c.seat] = this.ticks;
    const swing = { seat: c.seat, input: { t: "swing", dirX: msg.dirX, kind: msg.kind, level: msg.level, hand: msg.hand, lift: msg.lift, timingAim: msg.timingAim } };
    const back = rewindTicks(this.simTick, msg.tick, c.rtt);
    this.allowed[c.seat] = back;
    const events = back > 0 && this.playing() ? this.instance.rewind?.(swing, back) : null;
    if (events) {
      for (const e of events) this.report(e, e.type === "swing" ? back : 0);
      return;
    }
    this.pending.push(swing);
  }

  /** Only the player in a practice room can pause: nobody else is waiting on them. */
  pause(c: Client, paused: boolean): void {
    if (!this.practice || c.seat === null || this.paused === paused) return;
    this.paused = paused;
    this.deps.log("room_pause", { room: this.id, paused });
  }

  move(c: Client, x: number): void {
    if (c.seat === null) return;
    const w = this.moveWindow[c.seat];
    if (this.ticks - w.start >= 60) {
      w.start = this.ticks;
      w.count = 0;
    }
    if (++w.count > MOVES_PER_SECOND) return;
    this.pendingMove[c.seat] = x;
  }

  /** Movement mode for the sender's own seat only; the game validates the value. */
  mode(c: Client, mode: string): void {
    if (c.seat === null) return;
    this.pendingMode[c.seat] = mode;
    this.deps.log("move_mode", { room: this.id, seat: c.seat, mode });
  }

  isStale(now: number): boolean {
    return this.emptySince !== null && now - this.emptySince > EMPTY_ROOM_TTL_MS;
  }

  isClosed(): boolean {
    return this.closed;
  }

  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.deps.onDestroy(this);
    this.deps.log("room_destroy", { room: this.id });
  }

  /** A held seat's player didn't come back in time: tell everyone, then the room goes. */
  private close(): void {
    const held = this.lobby.view(this.deps.clock()).hold;
    const reason = held ? `${held.name} didn't come back in time` : "the room closed";
    if (this.lobby.format === "unlimited" && this.lobby.inMatch) this.recordUnlimited(this.seatTokens());
    this.deps.log("room_close", { room: this.id, reason });
    for (const c of this.clients()) {
      send(c, { t: "closed", room: this.id, reason });
      c.room = null;
      c.seat = null;
    }
    this.seats = [null, null];
    this.spectators.clear();
    this.destroy();
  }

  /** Logs what a step did; a player's own swing ruling also goes back to them. */
  private report(e: GameEvent, rewind: number): void {
    if (e.type === "swing") {
      const c = e.seat === undefined ? null : this.seats[e.seat];
      const rtt = c?.rtt === null || c?.rtt === undefined ? null : Math.round(c.rtt);
      const outcome = String(e.outcome);
      const allowed = e.seat === undefined || !c ? 0 : this.allowed[e.seat];
      this.deps.log("swing_resolve", { room: this.id, seat: e.seat, name: c?.name ?? "Bot", tick: this.simTick, allowed, rewind, rtt, outcome });
      if (c) send(c, { t: "swing", tick: this.simTick, outcome, rtt, allowed, rewind });
    } else if (e.type === "point") {
      const winner = e.winner as Seat;
      this.tally.points[winner]++;
      this.tally.bestRally = Math.max(this.tally.bestRally, Number(e.shots));
      this.deps.log("rally", { room: this.id, winner, shots: e.shots, reason: e.reason });
    } else if (e.type === "fault") {
      this.deps.log("fault", { room: this.id, server: e.server, reason: e.reason });
    }
  }

  private seatTokens(): [string | null, string | null] {
    const t = (s: Seat) => (this.lobby.seats[s] && !this.lobby.seats[s]!.bot ? this.lobby.seats[s]!.token : null);
    return [t(0), t(1)];
  }

  private recordUnlimited(tokens: [string | null, string | null]): void {
    if (this.recorded) return;
    this.recorded = true;
    this.deps.record({
      room: this.id,
      game: this.gameId,
      tokens,
      score: [...this.tally.points] as [number, number],
      winner: null,
      format: "unlimited",
      sets: [],
      practice: false,
      bestRally: this.tally.bestRally,
    });
    this.deps.log("match_end", { room: this.id, format: "unlimited", points: this.tally.points, bestRally: this.tally.bestRally });
  }

  pump(): void {
    if (this.closed) return;
    const target = Math.floor((this.deps.clock() - this.startedAt) / TICK_MS);
    let ran = 0;
    while (this.ticks < target && ran < MAX_CATCHUP_TICKS && !this.closed) {
      this.ticks++;
      this.advance();
      ran++;
    }
    if (this.ticks < target) {
      this.deps.log("tick_drift", { room: this.id, behind: target - this.ticks });
      this.ticks = target;
    }
  }

  private advance(): void {
    const next = this.lobby.tick(this.deps.clock());
    if (next === "close") return this.close();
    if (next === "start") {
      this.instance = this.newGame();
      this.deps.log("match_start", { room: this.id, format: this.lobby.format });
    } else if (next === "resume") this.deps.log("match_resume", { room: this.id });

    if (this.playing()) {
      const inputs = this.pending;
      for (const seat of [0, 1] as const) {
        const mode = this.pendingMode[seat];
        if (mode !== null) inputs.push({ seat, input: { t: "mode", mode } });
      }
      this.pendingMode = [null, null];
      for (const seat of [0, 1] as const) {
        const x = this.pendingMove[seat];
        if (x !== null) inputs.push({ seat, input: { t: "move", x } });
      }
      if (this.practice) {
        for (const input of this.instance.botInputs(BOT_SEAT)) inputs.push({ seat: BOT_SEAT, input });
      }
      this.simTick++;
      for (const e of this.instance.step(inputs)) this.report(e, 0);
    }
    this.pending = [];
    this.pendingMove = [null, null];
    if (this.ticks % BROADCAST_EVERY === 0) {
      this.broadcast({ t: "state", state: this.instance.snapshot() });
      this.syncLobby();
    }

    const result = this.instance.finished();
    if (result && !this.recorded) {
      this.recorded = true;
      this.deps.record({
        room: this.id,
        game: this.gameId,
        tokens: this.seatTokens(),
        score: result.score,
        winner: result.winner,
        format: result.format ?? "default",
        sets: result.sets ?? [],
        practice: this.practice,
      });
      this.deps.log("match_end", { room: this.id, score: result.score, sets: result.sets, format: result.format, winner: result.winner });
      // back to the ready check for a rematch; the finished game stays on
      // screen until the next one starts
      this.lobby.endMatch();
      this.broadcast({ t: "state", state: this.instance.snapshot() });
      this.syncLobby(true);
    }
  }
}
