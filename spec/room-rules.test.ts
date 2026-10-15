// Task 4 through the real Room (server/room.ts) with a fake clock, fake
// sockets and a short injected countdown and hold, so the 30 s rules run in
// milliseconds. The WebSocket side is in spec/rooms.test.ts.
import { describe, expect, it } from "vitest";
import type { TennisSnapshot } from "../shared/games/tennis/sim.ts";
import type { LobbyView, RoomFormat, ServerMsg } from "../shared/protocol.ts";
import { Room } from "../server/room.ts";
import type { Client } from "../server/room.ts";
import { isRated } from "../server/schema.ts";
import type { MatchRecord } from "../server/schema.ts";

const COUNTDOWN = 100;
const GRACE = 500;

interface Fake extends Client {
  seen: ServerMsg[];
}

function client(token: string, name = token): Fake {
  const seen: ServerMsg[] = [];
  return { ws: { readyState: 1, send: (s: string) => seen.push(JSON.parse(s)) } as Fake["ws"], token, name, room: null, seat: null, rtt: null, pings: 0, outstanding: null, seen };
}

function setup(format: RoomFormat = "oneSet", practice = false) {
  let now = 0;
  const records: MatchRecord[] = [];
  let destroyed = false;
  const room = new Room("TEST", "tennis", practice, format, {
    record: (m) => records.push(m),
    clock: () => now,
    log: () => {},
    timer: false,
    timing: { countdownMs: COUNTDOWN, graceMs: GRACE },
    onDestroy: () => (destroyed = true),
  });
  const run = (ms: number) => {
    for (const end = now + ms; now < end; ) {
      now = Math.min(end, now + 16);
      room.pump();
    }
  };
  return { room, records, run, destroyed: () => destroyed };
}

const last = <T extends ServerMsg["t"]>(c: Fake, t: T) => c.seen.filter((m) => m.t === t).at(-1) as Extract<ServerMsg, { t: T }> | undefined;
const lobby = (c: Fake) => last(c, "lobby") as (LobbyView & { t: "lobby" }) | undefined;
const tick = (c: Fake) => (last(c, "state")!.state as TennisSnapshot).tick;

describe("the room's ready flow (real Room, fake clock)", () => {
  it("the game doesn't move until both are ready and the countdown is over", () => {
    const { room, run } = setup();
    const a = client("a");
    const b = client("b");
    room.join(a);
    room.join(b);
    run(1000);
    expect(lobby(a)!.phase).toBe("ready-check");
    expect(tick(a)).toBe(0);
    room.ready(a, true);
    room.ready(b, true);
    expect(lobby(b)!.phase).toBe("countdown");
    run(COUNTDOWN / 2);
    expect(tick(a)).toBe(0);
    run(COUNTDOWN + 200);
    expect(lobby(a)!.phase).toBe("playing");
    expect(tick(a)).toBeGreaterThan(5);
  });

  it("a spectator can't ready or change the format, and sees the room's state", () => {
    const { room } = setup();
    const a = client("a");
    const b = client("b");
    const c = client("c");
    room.join(a);
    room.join(b);
    room.join(c);
    expect(c.seat).toBeNull();
    room.ready(c, true);
    expect(room.format(c, "unlimited")).toMatch(/host/);
    expect(lobby(c)!.seats.map((s) => s!.ready)).toEqual([false, false]);
    expect(lobby(c)!.format).toBe("oneSet");
  });

  it("practice vs bot starts at once: no ready check, no countdown", () => {
    const { room, run } = setup("oneSet", true);
    const a = client("a");
    room.join(a);
    expect(lobby(a)!.phase).toBe("playing");
    expect(lobby(a)!.seats[1]).toMatchObject({ name: "Bot", ready: true, bot: true });
    run(300);
    expect(tick(a)).toBeGreaterThan(5);
  });
});

describe("the 30 s hold (here 500 ms) on a dropped player's seat", () => {
  function inPlay() {
    const s = setup();
    const a = client("a", "Alice");
    const b = client("b", "Bob");
    s.room.join(a);
    s.room.join(b);
    s.room.ready(a, true);
    s.room.ready(b, true);
    s.run(COUNTDOWN + 100);
    return { ...s, a, b };
  }

  it("pauses the match, tells the other player and spectators who and how long, and the same token reclaims the seat", () => {
    const { room, run, a, b } = inPlay();
    const watcher = client("w");
    room.join(watcher);
    room.leave(b, true);
    const view = lobby(a)!;
    expect(view.phase).toBe("paused");
    expect(view.hold).toEqual({ seat: 1, name: "Bob", seconds: 1 });
    expect(lobby(watcher)!.hold?.name).toBe("Bob");
    const frozen = tick(a);
    run(200);
    expect(tick(a)).toBe(frozen);
    // a newcomer with another token can only watch
    const other = client("x");
    room.join(other);
    expect(other.seat).toBeNull();
    // back with the same token
    const back = client("b", "Bob");
    room.join(back);
    expect(back.seat).toBe(1);
    expect(lobby(a)!.phase).toBe("countdown");
    run(COUNTDOWN + 100);
    expect(lobby(a)!.phase).toBe("playing");
    expect(tick(a)).toBeGreaterThan(frozen);
  });

  it("closes the room if they don't come back in time, telling everyone, and records nothing", () => {
    const { room, run, records, destroyed, a } = inPlay();
    const watcher = client("w");
    room.join(watcher);
    room.leave(a, true);
    const b = room.seats[1] as Fake;
    run(GRACE - 50);
    expect(destroyed()).toBe(false);
    run(100);
    expect(destroyed()).toBe(true);
    expect(last(b, "closed")!.reason).toMatch(/Alice/);
    expect(last(watcher, "closed")).toBeDefined();
    expect(records).toEqual([]);
  });

  it("a disconnect before the match frees the seat (un-readied) and holds nothing", () => {
    const { room } = setup();
    const a = client("a");
    const b = client("b");
    room.join(a);
    room.join(b);
    room.ready(b, true);
    room.leave(b, true);
    expect(lobby(a)!.phase).toBe("waiting");
    expect(lobby(a)!.seats[1]).toBeNull();
    expect(lobby(a)!.hold).toBeNull();
  });
});

describe("unlimited: no winner, points and best rally, never rated, ends when someone leaves", () => {
  it("counts points, never finishes, and when a player leaves stores an unrated result with no winner", () => {
    const { room, run, records } = setup("unlimited");
    const a = client("a");
    const b = client("b");
    room.join(a);
    room.join(b);
    room.ready(a, true);
    room.ready(b, true);
    // nobody swings, so every serve goes unreturned and is a point
    run(COUNTDOWN + 20_000);
    const view = lobby(a)!;
    expect(view.format).toBe("unlimited");
    expect(view.tally!.points[0] + view.tally!.points[1]).toBeGreaterThan(3);
    expect(view.tally!.bestRally).toBeGreaterThanOrEqual(1);
    expect((last(a, "state")!.state as TennisSnapshot).endless).toBe(true);
    expect(records).toEqual([]);

    room.leave(b);
    expect(records).toHaveLength(1);
    const r = records[0];
    expect(r).toMatchObject({ format: "unlimited", winner: null, practice: false, tokens: ["a", "b"] });
    expect(r.score).toEqual(view.tally!.points);
    expect(isRated(r)).toBe(false);
  });

  it("a held seat that expires also ends unlimited with an unrated result", () => {
    const { room, run, records } = setup("unlimited");
    const a = client("a");
    const b = client("b");
    room.join(a);
    room.join(b);
    room.ready(a, true);
    room.ready(b, true);
    run(COUNTDOWN + 1000);
    room.leave(a, true);
    run(GRACE + 100);
    expect(records).toHaveLength(1);
    expect(isRated(records[0])).toBe(false);
  });

  it("the host's switch to unlimited makes a new endless game and clears ready", () => {
    const { room } = setup();
    const a = client("a");
    const b = client("b");
    room.join(a);
    room.join(b);
    room.ready(a, true);
    room.ready(b, true);
    expect(room.format(a, "unlimited")).toBeNull();
    expect(lobby(b)!.format).toBe("unlimited");
    expect(lobby(b)!.seats.map((s) => s!.ready)).toEqual([false, false]);
    expect((last(b, "state")!.state as TennisSnapshot).endless).toBe(true);
  });
});

describe("one player on two tabs (same token), allowed for testing", () => {
  it("both tabs take both seats; the shown names differ; a result between them isn't rated", () => {
    const { room } = setup();
    const t1 = client("same", "Sam");
    const t2 = client("same", "Sam");
    room.join(t1);
    room.join(t2);
    expect([t1.seat, t2.seat]).toEqual([0, 1]);
    expect(lobby(t1)!.seats.map((s) => s!.name)).toEqual(["Sam", "Sam (2)"]);
    expect(isRated({ room: "X", game: "tennis", tokens: ["same", "same"], score: [1, 0], winner: 0, format: "oneSet", sets: [[6, 0]], practice: false })).toBe(false);
  });
});
