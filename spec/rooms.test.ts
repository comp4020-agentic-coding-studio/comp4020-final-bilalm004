import { afterEach, describe, expect, inject, it } from "vitest";
import WebSocket from "ws";
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
    peer.send({ t: "swing", dirX: 1, power: 1 });
    const state = (await peer.next("state")).state as { phase: string; lastHitter: number | null };
    expect(state.phase).toBe("serve");
    expect(state.lastHitter).toBeNull();
  });
});
