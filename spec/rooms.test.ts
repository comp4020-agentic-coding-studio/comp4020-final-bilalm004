import { afterEach, describe, expect, inject, it } from "vitest";
import WebSocket from "ws";
import { COURT, DT, PLAYER } from "../shared/games/tennis/sim.ts";
import type { TennisSnapshot } from "../shared/games/tennis/sim.ts";
import type { ClientMsg, ServerMsg } from "../shared/protocol.ts";

const wsUrl = new URL("/ws", inject("baseUrl"));
wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";

const open: WebSocket[] = [];
afterEach(() => {
  for (const ws of open.splice(0)) ws.close();
});

class Peer {
  ws = new WebSocket(wsUrl);
  seen: ServerMsg[] = [];

  constructor() {
    open.push(this.ws);
    this.ws.on("message", (data) => this.seen.push(JSON.parse(data.toString()) as ServerMsg));
  }

  send(msg: ClientMsg): void {
    this.ws.send(JSON.stringify(msg));
  }

  async next<T extends ServerMsg["t"]>(type: T, timeoutMs = 5000): Promise<Extract<ServerMsg, { t: T }>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const i = this.seen.findIndex((m) => m.t === type);
      if (i !== -1) return this.seen.splice(i, 1)[0] as Extract<ServerMsg, { t: T }>;
      if (Date.now() > deadline) throw new Error(`no "${type}" message within ${timeoutMs}ms`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  static async connect(token?: string): Promise<{ peer: Peer; token: string; name: string }> {
    const peer = new Peer();
    await new Promise((resolve, reject) => {
      peer.ws.once("open", resolve);
      peer.ws.once("error", reject);
    });
    peer.send({ t: "hello", token });
    const welcome = await peer.next("welcome");
    return { peer, token: welcome.token, name: welcome.name };
  }
}

describe("rooms over WebSocket", () => {
  it("remembers a player by token across connections", async () => {
    const first = await Peer.connect();
    const second = await Peer.connect(first.token);
    expect(second.token).toBe(first.token);
    expect(second.name).toBe(first.name);
  });

  it("starts a practice room and streams game state", async () => {
    const { peer } = await Peer.connect();
    peer.send({ t: "create", game: "tennis", practice: true });
    const room = await peer.next("room");
    expect(room.practice).toBe(true);
    expect(room.seat).toBe(0);
    expect(room.room).toMatch(/^[A-Z]{4}$/);
    const state = await peer.next("state");
    expect(state.state).toHaveProperty("ball");
    // practice never ends, so the player can keep training
    expect((state.state as TennisSnapshot).winScore).toBeNull();
  });

  it("seats a second player, then makes the third a spectator", async () => {
    const a = await Peer.connect();
    a.peer.send({ t: "create", game: "tennis", practice: false });
    const room = await a.peer.next("room");

    const b = await Peer.connect();
    b.peer.send({ t: "join", room: room.room });
    expect((await b.peer.next("room")).seat).toBe(1);

    const c = await Peer.connect();
    c.peer.send({ t: "join", room: room.room.toLowerCase() });
    expect((await c.peer.next("room")).seat).toBeNull();
    expect(((await c.peer.next("state")).state as TennisSnapshot).winScore).toBe(COURT.winScore);
  });

  it("rejects an unknown room and a message before hello", async () => {
    const { peer } = await Peer.connect();
    peer.send({ t: "join", room: "ZZZZ" });
    expect((await peer.next("error")).message).toMatch(/not found/);

    const early = new Peer();
    await new Promise((resolve) => early.ws.once("open", resolve));
    early.send({ t: "create", game: "tennis", practice: true });
    expect((await early.next("error")).message).toMatch(/hello/);
  });

  it("ignores a swing during the serve: the client cannot move the ball", async () => {
    const { peer } = await Peer.connect();
    peer.send({ t: "create", game: "tennis", practice: true });
    await peer.next("room");
    peer.send({ t: "swing", dirX: 1, kind: "forehand", level: 2 });
    const state = (await peer.next("state")).state as { phase: string; lastHitter: number | null };
    expect(state.phase).toBe("serve");
    expect(state.lastHitter).toBeNull();
  });

  it("rejects a swing without a valid level or kind", async () => {
    const { peer } = await Peer.connect();
    peer.ws.send(JSON.stringify({ t: "swing", dirX: 0, power: 1 }));
    expect((await peer.next("error")).message).toMatch(/bad message/);
    peer.ws.send(JSON.stringify({ t: "swing", dirX: 0, kind: "forehand", level: 3 }));
    expect((await peer.next("error")).message).toMatch(/bad message/);
    peer.ws.send(JSON.stringify({ t: "swing", dirX: 0, kind: "smash", level: 1 }));
    expect((await peer.next("error")).message).toMatch(/bad message/);
    peer.ws.send(JSON.stringify({ t: "swing", dirX: 0, kind: "forehand", level: 1, lift: "high" }));
    expect((await peer.next("error")).message).toMatch(/bad message/);
    peer.ws.send(JSON.stringify({ t: "swing", dirX: 0, kind: "forehand", level: 1, timingAim: 1 }));
    expect((await peer.next("error")).message).toMatch(/bad message/);
  });

  it("moves the sender's player at no more than the speed cap, stopping at the side room", async () => {
    const { peer } = await Peer.connect();
    peer.send({ t: "create", game: "tennis", practice: true });
    await peer.next("room");
    const start = (await peer.next("state")).state as TennisSnapshot;
    peer.send({ t: "move", x: 1000 });
    const edge = COURT.halfW + PLAYER.sideRoom;
    for (;;) {
      const s = (await peer.next("state")).state as TennisSnapshot;
      expect(s.players[0].x).toBeLessThanOrEqual((s.tick - start.tick) * PLAYER.speed * DT + 1e-9);
      if (s.players[0].x === edge) break;
    }
  });

  it("ignores moves from a spectator", async () => {
    const a = await Peer.connect();
    a.peer.send({ t: "create", game: "tennis", practice: false });
    const room = await a.peer.next("room");
    const b = await Peer.connect();
    b.peer.send({ t: "join", room: room.room });
    await b.peer.next("room");
    const c = await Peer.connect();
    c.peer.send({ t: "join", room: room.room });
    await c.peer.next("room");
    c.peer.send({ t: "move", x: 3 });
    await new Promise((r) => setTimeout(r, 300));
    c.peer.seen.length = 0;
    const s = (await c.peer.next("state")).state as TennisSnapshot;
    expect(s.players.map((p) => p.x)).toEqual([0, 0]);
  });

  it("drops moves past the per-second limit, then accepts them again", async () => {
    const { peer } = await Peer.connect();
    peer.send({ t: "create", game: "tennis", practice: true });
    await peer.next("room");
    for (let i = 0; i < 40; i++) peer.send({ t: "move", x: 1 });
    for (let i = 0; i < 100; i++) peer.send({ t: "move", x: -1 });
    await new Promise((r) => setTimeout(r, 600));
    peer.seen.length = 0;
    expect(((await peer.next("state")).state as TennisSnapshot).players[0].targetX).toBe(1);

    await new Promise((r) => setTimeout(r, 1100));
    peer.send({ t: "move", x: -1 });
    await new Promise((r) => setTimeout(r, 100));
    peer.seen.length = 0;
    expect(((await peer.next("state")).state as TennisSnapshot).players[0].targetX).toBe(-1);
  });

  it("pauses a practice room while its player asks, and resumes", async () => {
    const { peer } = await Peer.connect();
    peer.send({ t: "create", game: "tennis", practice: true });
    await peer.next("room");
    peer.send({ t: "pause", paused: true });
    await new Promise((r) => setTimeout(r, 150));
    peer.seen.length = 0;
    const a = ((await peer.next("state")).state as TennisSnapshot).tick;
    await new Promise((r) => setTimeout(r, 300));
    peer.seen.length = 0;
    expect(((await peer.next("state")).state as TennisSnapshot).tick).toBe(a);

    peer.send({ t: "pause", paused: false });
    await new Promise((r) => setTimeout(r, 300));
    peer.seen.length = 0;
    expect(((await peer.next("state")).state as TennisSnapshot).tick).toBeGreaterThan(a + 10);
  });

  it("ignores pause in a two-player room", async () => {
    const a = await Peer.connect();
    a.peer.send({ t: "create", game: "tennis", practice: false });
    const room = await a.peer.next("room");
    const b = await Peer.connect();
    b.peer.send({ t: "join", room: room.room });
    await b.peer.next("room");
    a.peer.send({ t: "pause", paused: true });
    await new Promise((r) => setTimeout(r, 150));
    a.peer.seen.length = 0;
    const t0 = ((await a.peer.next("state")).state as TennisSnapshot).tick;
    await new Promise((r) => setTimeout(r, 300));
    a.peer.seen.length = 0;
    expect(((await a.peer.next("state")).state as TennisSnapshot).tick).toBeGreaterThan(t0 + 10);
  });

  it("unpauses a practice room when its player reconnects", async () => {
    const first = await Peer.connect();
    first.peer.send({ t: "create", game: "tennis", practice: true });
    const room = await first.peer.next("room");
    first.peer.send({ t: "pause", paused: true });
    await new Promise((r) => setTimeout(r, 100));
    first.peer.ws.close();

    const again = await Peer.connect(first.token);
    again.peer.send({ t: "join", room: room.room });
    await again.peer.next("room");
    const t0 = ((await again.peer.next("state")).state as TennisSnapshot).tick;
    await new Promise((r) => setTimeout(r, 300));
    again.peer.seen.length = 0;
    expect(((await again.peer.next("state")).state as TennisSnapshot).tick).toBeGreaterThan(t0 + 10);
  });
});
