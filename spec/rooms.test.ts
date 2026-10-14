import { afterEach, describe, expect, inject, it } from "vitest";
import WebSocket from "ws";
import { COURT, DT, PLAYER, hitWindowDistance, missReason } from "../shared/games/tennis/sim.ts";
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

/** Ready both seats of a two-player room and wait out the 3 s countdown. */
async function readyBoth(a: Peer, b: Peer): Promise<void> {
  a.send({ t: "ready", ready: true });
  b.send({ t: "ready", ready: true });
  const deadline = Date.now() + 6000;
  for (;;) {
    const l = await a.next("lobby");
    if (l.phase === "playing") return;
    if (Date.now() > deadline) throw new Error(`room never started playing (phase ${l.phase})`);
  }
}

/** The latest lobby message a peer has, waiting for one that matches. */
async function lobbyWhere(p: Peer, ok: (l: Extract<ServerMsg, { t: "lobby" }>) => boolean, timeoutMs = 5000): Promise<Extract<ServerMsg, { t: "lobby" }>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const l = await p.next("lobby", Math.max(1, deadline - Date.now()));
    if (ok(l)) return l;
  }
}

describe("room rules over WebSocket (task 4)", () => {
  it("a two-player room waits for both to ready, counts down, then plays", async () => {
    const a = await Peer.connect();
    a.peer.send({ t: "create", game: "tennis", practice: false });
    const room = await a.peer.next("room");
    expect((await a.peer.next("lobby")).phase).toBe("waiting");
    const b = await Peer.connect();
    b.peer.send({ t: "join", room: room.room });
    await b.peer.next("room");
    const check = await lobbyWhere(b.peer, (l) => l.phase === "ready-check");
    expect(check.host).toBe(0);
    expect(check.format).toBe("oneSet");
    expect(check.seats.map((s) => s?.ready)).toEqual([false, false]);
    // the game doesn't move during the ready check
    await new Promise((r) => setTimeout(r, 300));
    b.peer.seen.length = 0;
    expect(((await b.peer.next("state")).state as TennisSnapshot).tick).toBe(0);

    a.peer.send({ t: "ready", ready: true });
    b.peer.send({ t: "ready", ready: true });
    const counting = await lobbyWhere(b.peer, (l) => l.phase === "countdown");
    expect(counting.countdown).toBe(3);
    await lobbyWhere(b.peer, (l) => l.phase === "playing", 6000);
    await new Promise((r) => setTimeout(r, 300));
    b.peer.seen.length = 0;
    expect(((await b.peer.next("state")).state as TennisSnapshot).tick).toBeGreaterThan(5);
  });

  it("un-readying cancels the countdown; the host's format change clears both ready flags", async () => {
    const a = await Peer.connect();
    a.peer.send({ t: "create", game: "tennis", practice: false });
    const room = await a.peer.next("room");
    const b = await Peer.connect();
    b.peer.send({ t: "join", room: room.room });
    await b.peer.next("room");
    a.peer.send({ t: "ready", ready: true });
    b.peer.send({ t: "ready", ready: true });
    await lobbyWhere(a.peer, (l) => l.phase === "countdown");
    b.peer.send({ t: "ready", ready: false });
    await lobbyWhere(a.peer, (l) => l.phase === "ready-check" && l.countdown === null);

    b.peer.send({ t: "ready", ready: true });
    await lobbyWhere(a.peer, (l) => l.phase === "countdown");
    a.peer.send({ t: "format", format: "bestOfThree" });
    const changed = await lobbyWhere(b.peer, (l) => l.format === "bestOfThree");
    expect(changed.phase).toBe("ready-check");
    expect(changed.seats.map((s) => s?.ready)).toEqual([false, false]);
    // the game's own score follows (older states may still be queued)
    b.peer.seen = b.peer.seen.filter((m) => m.t !== "state");
    expect(((await b.peer.next("state")).state as TennisSnapshot).score.format).toBe("bestOfThree");
    // only the host may change it
    b.peer.send({ t: "format", format: "unlimited" });
    expect((await b.peer.next("error")).message).toMatch(/host/);
  });

  it("a disconnect before the match frees and un-readies the seat", async () => {
    const a = await Peer.connect();
    a.peer.send({ t: "create", game: "tennis", practice: false });
    const room = await a.peer.next("room");
    const b = await Peer.connect();
    b.peer.send({ t: "join", room: room.room });
    await b.peer.next("room");
    b.peer.send({ t: "ready", ready: true });
    await lobbyWhere(a.peer, (l) => l.seats[1]?.ready === true);
    b.peer.ws.close();
    const after = await lobbyWhere(a.peer, (l) => l.seats[1] === null);
    expect(after.phase).toBe("waiting");
    const again = await Peer.connect(b.token);
    again.peer.send({ t: "join", room: room.room });
    expect((await again.peer.next("room")).seat).toBe(1);
    expect((await lobbyWhere(a.peer, (l) => l.seats[1] !== null)).seats[1]!.ready).toBe(false);
  });

  it("a mid-match drop pauses and shows who and how long; the same token reclaims the seat and play resumes", async () => {
    const a = await Peer.connect();
    a.peer.send({ t: "create", game: "tennis", practice: false });
    const room = await a.peer.next("room");
    const b = await Peer.connect();
    b.peer.send({ t: "join", room: room.room });
    await b.peer.next("room");
    await readyBoth(a.peer, b.peer);
    b.peer.ws.close();
    const held = await lobbyWhere(a.peer, (l) => l.phase === "paused");
    expect(held.hold).toEqual({ seat: 1, name: b.name, seconds: expect.any(Number) });
    expect(held.hold!.seconds).toBeGreaterThan(25);
    expect(held.hold!.seconds).toBeLessThanOrEqual(30);

    const back = await Peer.connect(b.token);
    back.peer.send({ t: "join", room: room.room });
    expect((await back.peer.next("room")).seat).toBe(1);
    await lobbyWhere(a.peer, (l) => l.phase === "countdown" && l.hold === null);
    await lobbyWhere(a.peer, (l) => l.phase === "playing", 6000);
  }, 20_000);

  it("one player on two tabs (same token) may take both seats, for testing", async () => {
    const first = await Peer.connect();
    first.peer.send({ t: "create", game: "tennis", practice: false });
    const room = await first.peer.next("room");
    const second = await Peer.connect(first.token);
    expect(second.token).toBe(first.token);
    second.peer.send({ t: "join", room: room.room });
    expect((await second.peer.next("room")).seat).toBe(1);
    const l = await lobbyWhere(first.peer, (v) => v.seats[1] !== null);
    expect(l.seats.map((s) => s!.name)).toEqual([first.name, `${first.name} (2)`]);
    await readyBoth(first.peer, second.peer);
  });

  it("the invite code still joins (any case) and the joiner gets the room's state", async () => {
    const a = await Peer.connect();
    a.peer.send({ t: "create", game: "tennis", practice: false, format: "unlimited" });
    const room = await a.peer.next("room");
    const b = await Peer.connect();
    b.peer.send({ t: "join", room: room.room.toLowerCase() });
    expect((await b.peer.next("room")).room).toBe(room.room);
    const l = await b.peer.next("lobby");
    expect(l.format).toBe("unlimited");
    expect(l.tally).toEqual({ points: [0, 0], bestRally: 0 });
  });

  it("practice vs bot stays instant: playing at once, the bot always ready", async () => {
    const { peer } = await Peer.connect();
    peer.send({ t: "create", game: "tennis", practice: true });
    await peer.next("room");
    const l = await peer.next("lobby");
    expect(l.phase).toBe("playing");
    expect(l.seats[1]).toMatchObject({ name: "Bot", ready: true, bot: true });
    peer.send({ t: "ready", ready: false });
    peer.send({ t: "format", format: "unlimited" });
    expect((await peer.next("error")).message).toMatch(/host/);
  });

  it("rejects malformed or hostile ready and format messages", async () => {
    const { peer } = await Peer.connect();
    for (const bad of [
      { t: "ready" },
      { t: "ready", ready: "yes" },
      { t: "ready", ready: 1 },
      { t: "format" },
      { t: "format", format: "firstToAMillion" },
      { t: "format", format: "__proto__" },
      { t: "format", format: ["oneSet"] },
      { t: "lobby", phase: "playing" },
      { t: "closed", room: "ABCD" },
    ]) {
      peer.ws.send(JSON.stringify(bad));
      expect((await peer.next("error")).message, JSON.stringify(bad)).toMatch(/bad message/);
    }
    // valid, but not in a room
    peer.send({ t: "format", format: "bestOfThree" });
    expect((await peer.next("error")).message).toMatch(/room/);
  });
});

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
    expect((state.state as TennisSnapshot).endless).toBe(true);
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
    const snap = (await c.peer.next("state")).state as TennisSnapshot;
    expect(snap.endless).toBe(false);
  });

  it("every state carries the server's tennis score: points, games, sets, server, format", async () => {
    const { peer } = await Peer.connect();
    peer.send({ t: "create", game: "tennis", practice: false });
    await peer.next("room");
    const snap = (await peer.next("state")).state as TennisSnapshot;
    expect(snap.score).toEqual({
      format: "oneSet",
      server: 0,
      points: [0, 0],
      games: [0, 0],
      sets: [0, 0],
      setScores: [],
      tiebreak: false,
      tiebreakFirst: 0,
      gameServer: 0,
      faults: 0,
      winner: null,
    });
    expect(snap.server).toBe(snap.score.server);
    expect(snap.lastCall).toBeNull();
    // the old first-to-5 field is gone
    expect(snap).not.toHaveProperty("winScore");
  });

  it("a room can be made best of three; an unknown format gets one set", async () => {
    const a = await Peer.connect();
    a.peer.send({ t: "create", game: "tennis", practice: false, format: "bestOfThree" });
    await a.peer.next("room");
    expect(((await a.peer.next("state")).state as TennisSnapshot).score.format).toBe("bestOfThree");

    const b = await Peer.connect();
    b.peer.send({ t: "create", game: "tennis", practice: false, format: "firstToAMillion" });
    await b.peer.next("room");
    expect(((await b.peer.next("state")).state as TennisSnapshot).score.format).toBe("oneSet");
  });

  it("a point won against the bot shows up in the score the server sends", async () => {
    const { peer } = await Peer.connect();
    peer.send({ t: "create", game: "tennis", practice: true });
    await peer.next("room");
    // seat 0 serves and the bot returns or not; within a few points someone scores
    const deadline = Date.now() + 15_000;
    let snap: TennisSnapshot | null = null;
    while (Date.now() < deadline) {
      snap = (await peer.next("state")).state as TennisSnapshot;
      if (snap.lastCall !== null) break;
    }
    expect(snap?.lastCall).not.toBeNull();
    const { points, games, faults } = snap!.score;
    expect(points[0] + points[1] + games[0] + games[1] + faults).toBeGreaterThan(0);
  }, 20_000);

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

  it("pings each client and times the round trip", async () => {
    const { peer } = await Peer.connect();
    const ping = await peer.next("ping");
    peer.send({ t: "pong", id: ping.id });
    peer.send({ t: "create", game: "tennis", practice: true });
    await peer.next("room");
    peer.send({ t: "swing", dirX: 0, kind: "forehand", level: 1 });
    const ruling = await peer.next("swing");
    expect(ruling.rtt).not.toBeNull();
    expect(ruling.rtt!).toBeGreaterThanOrEqual(0);
    expect(ruling.rtt!).toBeLessThan(1000);
  });

  it("ignores a pong for a ping it never sent", async () => {
    const { peer } = await Peer.connect();
    const ping = await peer.next("ping");
    peer.send({ t: "pong", id: ping.id + 99 });
    peer.send({ t: "create", game: "tennis", practice: true });
    await peer.next("room");
    peer.send({ t: "swing", dirX: 0, kind: "forehand", level: 1 });
    expect((await peer.next("swing")).rtt).toBeNull();
  });

  it("tells the swinger the server's ruling, here no ball during the serve", async () => {
    const { peer } = await Peer.connect();
    peer.send({ t: "create", game: "tennis", practice: true });
    await peer.next("room");
    peer.send({ t: "swing", dirX: 0, kind: "forehand", level: 1 });
    const ruling = await peer.next("swing");
    expect(ruling.outcome).toBe("no ball");
    expect(ruling.tick).toBeGreaterThan(0);
  });

  it("judges a swing with no measured lag at arrival: an unanswered ping means no rewind", async () => {
    const { peer } = await Peer.connect();
    // never answer the ping
    peer.send({ t: "create", game: "tennis", practice: true });
    await peer.next("room");
    const state = (await peer.next("state")).state as TennisSnapshot;
    peer.send({ t: "swing", dirX: 0, kind: "forehand", level: 1, tick: state.tick - 5 });
    expect((await peer.next("swing")).allowed).toBe(0);
  });

  it("rewinds a swing with measured lag to the tick it claims, within the cap", async () => {
    const { peer } = await Peer.connect();
    peer.send({ t: "pong", id: (await peer.next("ping")).id });
    peer.send({ t: "create", game: "tennis", practice: true });
    await peer.next("room");
    // wait for the serve to reach this player, so there is a ball to rewind to
    let s = (await peer.next("state")).state as TennisSnapshot;
    for (let i = 0; i < 400 && !(s.phase === "rally" && s.lastHitter === 1 && s.ball.z > COURT.halfL - 3); i++) {
      s = (await peer.next("state")).state as TennisSnapshot;
    }
    peer.seen.length = 0;
    const claimed = s.tick - 3;
    peer.send({ t: "swing", dirX: 0, kind: "forehand", level: 1, tick: claimed });
    const ruling = await peer.next("swing");
    // the swing may reach the server a tick or two later than it was sent, so
    // bound the ruling instead of pinning it: never more than the claim as seen
    // at the judged tick, never over the 9-tick cap
    expect(ruling.allowed).toBeLessThanOrEqual(Math.min(ruling.tick - claimed, 9));
    // a local round trip is a few ms, and the 50 ms margin alone covers 3 ticks,
    // so the claim is honoured
    expect(ruling.allowed).toBeGreaterThanOrEqual(3);
    // how far it was actually judged back can't exceed what was allowed
    expect(ruling.rewind).toBeLessThanOrEqual(ruling.allowed);
  });

  it("rejects a swing whose tick isn't a whole number", async () => {
    const { peer } = await Peer.connect();
    peer.ws.send(JSON.stringify({ t: "swing", dirX: 0, kind: "forehand", level: 1, tick: 1.5 }));
    expect((await peer.next("error")).message).toMatch(/bad message/);
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
    await readyBoth(a.peer, b.peer);
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

describe("movement mode (task 2: auto-move)", () => {
  it("accepts auto and tilt, and rejects an unknown or missing movement mode", async () => {
    const { peer } = await Peer.connect();
    peer.send({ t: "mode", mode: "tilt" });
    peer.send({ t: "mode", mode: "auto" });
    await new Promise((r) => setTimeout(r, 300));
    expect(peer.seen.filter((m) => m.t === "error")).toEqual([]);
    for (const bad of [{ t: "mode", mode: "run" }, { t: "mode" }, { t: "mode", mode: 1 }]) {
      peer.ws.send(JSON.stringify(bad));
      expect((await peer.next("error")).message).toMatch(/bad message/);
    }
  });

  it("applies a seat's mode to that seat only; both start in auto", async () => {
    const a = await Peer.connect();
    a.peer.send({ t: "create", game: "tennis", practice: false });
    const room = await a.peer.next("room");
    const b = await Peer.connect();
    b.peer.send({ t: "join", room: room.room });
    await b.peer.next("room");
    // modes reach the game once it steps, which is after the ready check
    await readyBoth(a.peer, b.peer);
    await new Promise((r) => setTimeout(r, 150));
    b.peer.seen.length = 0;
    expect(((await b.peer.next("state")).state as TennisSnapshot).movement.map((m) => m.mode)).toEqual(["auto", "auto"]);

    a.peer.send({ t: "mode", mode: "tilt" });
    await new Promise((r) => setTimeout(r, 150));
    b.peer.seen.length = 0;
    expect(((await b.peer.next("state")).state as TennisSnapshot).movement.map((m) => m.mode)).toEqual(["tilt", "auto"]);

    b.peer.send({ t: "mode", mode: "tilt" });
    a.peer.send({ t: "mode", mode: "auto" });
    await new Promise((r) => setTimeout(r, 150));
    a.peer.seen.length = 0;
    expect(((await a.peer.next("state")).state as TennisSnapshot).movement.map((m) => m.mode)).toEqual(["auto", "tilt"]);
  });

  it("in auto, the server walks the player to the incoming ball without any move messages", async () => {
    const { peer } = await Peer.connect();
    peer.send({ t: "create", game: "tennis", practice: true });
    await peer.next("room");
    // seat 0 never swings, so the bot's serves (alternate games) and returns
    // of seat 0's serves come at it; wait for one in the hit window
    const deadline = Date.now() + 25_000;
    let met: TennisSnapshot | null = null;
    while (Date.now() < deadline && !met) {
      const s = (await peer.next("state")).state as TennisSnapshot;
      const why = s.phase === "rally" ? missReason({ ...s, rng: 0 }, 0) : "no ball";
      // in the on-time third (task 12: at the early edge of the wider window
      // the ball hasn't drifted out to auto's offset yet)
      const onTime = Math.abs(s.ball.z - COURT.halfL) <= hitWindowDistance(s.ball) / 3;
      if (why === null && onTime) met = s;
    }
    expect(met, "no incoming ball was ever in reach").not.toBeNull();
    expect(met!.movement[0]).toEqual({ mode: "auto", manual: false });
    expect(Math.abs(met!.ball.x - met!.players[0].x)).toBeLessThanOrEqual(PLAYER.reach);
    // it was walked there (it starts in the middle and stops short of the ball, beside it)
    expect(met!.players[0].x).not.toBe(0);
    expect(Math.abs(met!.ball.x - met!.players[0].x)).toBeGreaterThan(0.1);
  }, 30_000);
});
