// Archery through the same Room, Lobby and protocol as tennis (task 22), with
// a fake clock and fake sockets like spec/room-rules.test.ts.
import { describe, expect, it } from "vitest";
import { solveAim } from "../shared/games/archery/bot.ts";
import type { ArcherySnapshot } from "../shared/games/archery/sim.ts";
import { parseClientMsg } from "../shared/protocol.ts";
import type { LobbyView, RoomFormat, ServerMsg } from "../shared/protocol.ts";
import { Room } from "../server/room.ts";
import type { Client } from "../server/room.ts";
import { asRoomFormat } from "../server/rooms.ts";
import { isRated } from "../server/schema.ts";
import type { MatchRecord } from "../server/schema.ts";

const COUNTDOWN = 100;

interface Fake extends Client {
  seen: ServerMsg[];
}

function client(token: string): Fake {
  const seen: ServerMsg[] = [];
  return { ws: { readyState: 1, send: (s: string) => seen.push(JSON.parse(s)) } as Fake["ws"], token, name: token, room: null, seat: null, rtt: null, pings: 0, outstanding: null, seen };
}

function setup(format: RoomFormat = "stages", practice = false) {
  let now = 0;
  const records: MatchRecord[] = [];
  const room = new Room("ARCH", "archery", practice, format, {
    record: (m) => records.push(m),
    clock: () => now,
    log: () => {},
    timer: false,
    timing: { countdownMs: COUNTDOWN, graceMs: 500 },
    onDestroy: () => {},
  });
  const run = (ms: number) => {
    for (const end = now + ms; now < end; ) {
      now = Math.min(end, now + 16);
      room.pump();
    }
  };
  return { room, records, run };
}

const last = <T extends ServerMsg["t"]>(c: Fake, t: T) => c.seen.filter((m) => m.t === t).at(-1) as Extract<ServerMsg, { t: T }> | undefined;
const lobby = (c: Fake) => last(c, "lobby") as (LobbyView & { t: "lobby" }) | undefined;
const state = (c: Fake) => last(c, "state")!.state as ArcherySnapshot;

function seated(format: RoomFormat = "stages") {
  const s = setup(format);
  const a = client("a");
  const b = client("b");
  s.room.join(a);
  s.room.join(b);
  s.room.ready(a, true);
  s.room.ready(b, true);
  s.run(COUNTDOWN + 50);
  return { ...s, a, b };
}

/** Runs until it is `c`'s turn to shoot, then shoots `aim`, then lets the arrow land. */
function shootAs(s: ReturnType<typeof seated>, c: Fake, aim: { yaw: number; pitch: number; draw: number }) {
  for (let i = 0; i < 400 && !(state(c).phase === "aim" && state(c).turn === c.seat); i++) s.run(16);
  s.room.aim(c, { t: "release", ...aim });
  s.run(3000);
}

describe("archery rooms", () => {
  it("offers its own formats: the eight-stage match by default, or unlimited", () => {
    expect(asRoomFormat(undefined, "archery")).toBe("stages");
    expect(asRoomFormat("unlimited", "archery")).toBe("unlimited");
    expect(asRoomFormat("bestOfThree", "archery")).toBe("stages");
    expect(asRoomFormat("stages", "tennis")).toBe("oneSet");
    const { room, a } = (() => {
      const s = setup();
      const c = client("a");
      s.room.join(c);
      return { room: s.room, a: c };
    })();
    expect(room.format(a, "oneSet")).toMatch(/no such format/);
    expect(room.format(a, "unlimited")).toBeNull();
    expect(lobby(a)!.format).toBe("unlimited");
  });

  it("parses aim and release messages and drops junk", () => {
    expect(parseClientMsg(JSON.stringify({ t: "release", yaw: 0.1, pitch: 0.05, draw: 0.9 }))).toEqual({ t: "release", yaw: 0.1, pitch: 0.05, draw: 0.9 });
    expect(parseClientMsg(JSON.stringify({ t: "aim", yaw: "left", pitch: 0, draw: 1 }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "release", yaw: 0, pitch: 0 }))).toBeNull();
  });

  it("the server flies the shooter's arrow and scores it; the other seat can't shoot out of turn", () => {
    const s = seated();
    expect(state(s.a).turn).toBe(0);
    s.room.aim(s.b, { t: "release", yaw: 0, pitch: 0, draw: 1 });
    s.run(100);
    expect(state(s.a).phase).toBe("aim");
    const st = state(s.a);
    shootAs(s, s.a, solveAim(st.distance, st.wind, 1));
    const shot = state(s.b).shots[0];
    expect(shot).toMatchObject({ seat: 0, bullseye: true });
    expect(state(s.b).totals[0]).toBe(shot.points);
    expect(state(s.b).turn).toBe(1);
  });

  it("the latest sight reaches every viewer while the shooter draws", () => {
    const s = seated();
    s.room.aim(s.a, { t: "aim", yaw: 0.1, pitch: 0.05, draw: 0.3 });
    s.room.aim(s.a, { t: "aim", yaw: 0.12, pitch: 0.06, draw: 0.6 });
    s.run(100);
    expect(state(s.b).aim).toEqual({ yaw: 0.12, pitch: 0.06, draw: 0.6 });
  });

  it("a finished match is recorded as archery, rated between two people", () => {
    const s = seated();
    for (let i = 0; i < 16; i++) {
      const shooter = state(s.a).turn === 0 ? s.a : s.b;
      // seat 0 aims true, seat 1 wide
      const st = state(s.a);
      shootAs(s, shooter, shooter === s.a ? solveAim(st.distance, st.wind, 1) : { yaw: 0.3, pitch: 0, draw: 1 });
    }
    s.run(500);
    expect(s.records).toHaveLength(1);
    const r = s.records[0];
    expect(r).toMatchObject({ game: "archery", format: "stages", winner: 0, practice: false });
    expect(r.score[1]).toBe(0);
    expect(isRated(r)).toBe(true);
  });

  it("unlimited counts arrow points and the best arrow, and leaving stores it unrated", () => {
    const s = seated("unlimited");
    // nobody shoots: every arrow is lost to the shot clock, then one good one
    const st = () => state(s.a);
    for (let i = 0; i < 400 && !(st().phase === "aim" && st().turn === 0); i++) s.run(16);
    shootAs(s, s.a, solveAim(st().distance, st().wind, 1));
    const view = lobby(s.a)!;
    expect(view.tally!.points[0]).toBe(11);
    expect(view.tally!.bestRally).toBe(11);
    expect(st().format).toBe("unlimited");
    s.room.leave(s.b);
    expect(s.records).toHaveLength(1);
    expect(s.records[0]).toMatchObject({ game: "archery", format: "unlimited", winner: null });
    expect(isRated(s.records[0])).toBe(false);
  });

  it("practice vs the bot starts at once, the bot shoots its turns, and it is never rated", () => {
    const s = setup("stages", true);
    const a = client("a");
    s.room.join(a);
    expect(lobby(a)!.phase).toBe("playing");
    // the person lets the shot clock run; the bot still shoots its own turns
    s.run(40_000);
    const bot = state(a).shots.filter((sh) => sh.seat === 1);
    expect(bot.length).toBeGreaterThan(0);
    expect(bot.some((sh) => sh.points > 0)).toBe(true);
    expect(s.records.every((r) => !isRated(r))).toBe(true);
  });
});
