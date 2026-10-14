// Task 2: auto-move. In "auto" the server moves a seat to the ball, stopping
// AUTO_OFFSET short of it on the side the ball was heading toward, at the
// normal capped speed. "tilt" leaves movement to the player's own move
// messages (shoulder tilt, keys, buttons).
import { describe, expect, it } from "vitest";
import { botInputs } from "../shared/games/tennis/bot.ts";
import { asInput, tennis, tennisFrom } from "../shared/games/tennis/index.ts";
import {
  AUTO_OFFSET,
  AUTO_SPEED,
  LEVEL_NAMES,
  COURT,
  DT,
  EITHER_SIDE,
  PLAYER,
  autoTargetX,
  createState,
  missReason,
  naturalKind,
  predictContact,
  snapshot,
  step,
} from "../shared/games/tennis/sim.ts";
import type { Ball, Level, MoveMode, Seat, TennisInput, TennisSnapshot, TennisState } from "../shared/games/tennis/sim.ts";

/** `seat` is about to receive `ball` and stands at `x`, in `mode`. */
function receiving(seat: Seat, ball: Ball, x: number, mode: MoveMode = "auto"): TennisState {
  const s = createState(1, { moveMode: mode });
  s.phase = "rally";
  s.lastHitter = seat === 0 ? 1 : 0;
  s.shots = 1;
  s.ball = { ...ball };
  s.players[seat] = { x, targetX: x };
  return s;
}

/** A ball from the far half heading to `seat`, aimed to cross its baseline near `endX`. */
function incoming(seat: Seat, startX: number, vx: number): Ball {
  const dir = seat === 0 ? 1 : -1;
  return { x: startX, y: 1.2, z: -dir * 2, vx, vy: 3, vz: dir * 13 };
}

/** Steps until the ball is at the middle of `seat`'s hit window (predictContact's ticks reach 0). */
function toContact(s: TennisState, seat: Seat): void {
  for (let i = 0; i < 600; i++) {
    const c = predictContact(s, seat);
    if (!c || c.ticks === 0) return;
    step(s, []);
  }
}

describe("auto-move", () => {
  it("a real game (so every room) starts both seats in auto; a bare sim starts them manual", () => {
    expect((tennis.create(1).snapshot() as TennisSnapshot).movement.map((m) => m.mode)).toEqual(["auto", "auto"]);
    expect(createState(1).movement.map((m) => m.mode)).toEqual(["tilt", "tilt"]);
  });

  it("reaches every reachable ball and stops AUTO_OFFSET short of it, in reach", () => {
    let reachable = 0;
    for (const seat of [0, 1] as const) {
      for (const startX of [-3, -1, 0, 1.5, 3]) {
        for (const vx of [-3, -1.5, 0, 1, 2.5]) {
          for (const from of [-4, 0, 4]) {
            const s = receiving(seat, incoming(seat, startX, vx), from);
            const c = predictContact(s, seat);
            if (!c) continue;
            const target = autoTargetX(s, seat);
            // only balls the capped speed can get to in time
            if (Math.abs(target - from) > PLAYER.speed * AUTO_SPEED * c.ticks * DT) continue;
            reachable++;
            toContact(s, seat);
            expect(s.players[seat].x).toBeCloseTo(target, 9);
            expect(Math.abs(s.ball.x - s.players[seat].x)).toBeCloseTo(AUTO_OFFSET, 9);
            expect(missReason(s, seat)).toBeNull();
          }
        }
      }
    }
    expect(reachable).toBeGreaterThan(80);
  });

  it("the offset is on the side the ball was heading to, so its natural kind connects and the other is wrong side", () => {
    // seat 0 faces -z, its right is +x; seat 1 faces +z, its right is -x
    const cases: [Seat, number, "forehand" | "backhand"][] = [
      [0, 2, "forehand"],
      [0, -2, "backhand"],
      [1, 2, "backhand"],
      [1, -2, "forehand"],
    ];
    for (const [seat, endX, kind] of cases) {
      // a straight ball (vx 0) toward x = endX, from a player in the middle
      const s = receiving(seat, incoming(seat, endX, 0), 0);
      toContact(s, seat);
      const p = s.players[seat].x;
      expect(Math.abs(s.ball.x - p)).toBeGreaterThan(EITHER_SIDE);
      expect(naturalKind(seat, p, s.ball.x)).toBe(kind);
      expect(missReason(s, seat, kind)).toBeNull();
      expect(missReason(s, seat, kind === "forehand" ? "backhand" : "forehand")).toBe("wrong side");
      // and the swing really connects
      const hit = createSwingAt(s, seat, kind);
      expect(hit).toBe("hit");
    }
  });

  it("never moves faster than the auto speed cap, slower than manual, in a whole bot-vs-bot game in auto", () => {
    expect(AUTO_SPEED).toBeGreaterThan(0);
    expect(AUTO_SPEED).toBeLessThan(1);
    const g = tennis.create(11);
    let prev = (g.snapshot() as TennisSnapshot).players.map((p) => p.x);
    for (let i = 0; i < 60 * 90; i++) {
      // the bot steers by move messages; drop them so auto does the moving
      const swings = [0, 1].flatMap((seat) =>
        g.botInputs(seat as Seat).filter((x) => (x as TennisInput).t === "swing").map((input) => ({ seat: seat as Seat, input })),
      );
      g.step(swings);
      const now = (g.snapshot() as TennisSnapshot).players.map((p) => p.x);
      for (const k of [0, 1]) expect(Math.abs(now[k] - prev[k])).toBeLessThanOrEqual(PLAYER.speed * AUTO_SPEED * DT + 1e-9);
      prev = now;
    }
  });

  it("a ball beyond reach is still missed: auto runs at the capped speed, not to the ball", () => {
    // bounces in near x 2.6 and reaches the baseline about 0.6 s from now
    const wide: Ball = { x: 1, y: 0.6, z: -4, vx: 3, vy: 1.5, vz: -12 };
    const s = receiving(1, wide, -3);
    let touched = false;
    for (let i = 0; i < 120; i++) {
      const kind = naturalKind(1, s.players[1].x, s.ball.x);
      const ev = step(s, [{ t: "swing", seat: 1, dirX: 0, kind, level: 1 }]);
      touched ||= ev.some((e) => e.type === "swing" && e.outcome === "hit");
    }
    expect(touched).toBe(false);
    expect(s.score.points).toEqual([1, 0]);
  });

  it("a move message in auto walks at the full manual speed", () => {
    const s = createState(1, { moveMode: "auto" });
    step(s, [{ t: "move", seat: 0, x: 1000 }]);
    for (let i = 0; i < 29; i++) step(s, []);
    expect(s.players[0].x).toBeCloseTo(30 * PLAYER.speed * DT, 9);
    // the other seat, untouched, stays in the middle
    expect(s.players[1].x).toBe(0);
  });

  it("strength matters: an auto-moving player from the far sideline reaches light shots most, hard least", () => {
    const rates = ([0, 1] as const).map((aim) => ([0, 1, 2] as const).map((level) => reachRate(level, aim)));
    // straight shots are always reached, at every level
    for (const r of rates[0]) expect(r).toBe(1);
    const [light, medium, hard] = rates[1];
    expect(light).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(hard);
    // the user's targets: hard wide beats auto, medium is borderline, light almost never does
    expect(hard).toBeLessThanOrEqual(0.1);
    expect(medium).toBeGreaterThanOrEqual(0.25);
    expect(medium).toBeLessThanOrEqual(0.75);
    expect(light).toBeGreaterThanOrEqual(0.9);
    console.log(
      "auto reach rate from the far sideline, full aim:",
      rates[1].map((r, i) => `${LEVEL_NAMES[i]} ${Math.round(r * 100)}%`).join(", "),
    );
  });

  it("tilt leaves the player where their own moves put them", () => {
    const s = receiving(1, incoming(1, 2, 0), -2, "tilt");
    toContact(s, 1);
    expect(s.players[1].x).toBe(-2);
  });

  it("a mode input changes only that seat; a move in auto takes over until the next ball comes at you", () => {
    const s = createState(3, { moveMode: "auto" });
    step(s, [{ t: "mode", seat: 0, mode: "tilt" }]);
    expect(s.movement.map((m) => m.mode)).toEqual(["tilt", "auto"]);
    // seat 1 (auto) keys a move during the serve: it is followed
    step(s, [{ t: "move", seat: 1, x: 3 }]);
    for (let i = 0; i < 30; i++) step(s, []);
    expect(s.players[1].targetX).toBe(3);
    // the serve comes at seat 1: auto takes over again
    while (s.phase === "serve") step(s, []);
    step(s, []);
    expect(s.movement[1].manual).toBe(false);
    expect(s.players[1].targetX).toBeCloseTo(autoTargetX(s, 1), 6);
  });

  it("with no ball coming, auto goes back to the middle; the server still serves", () => {
    const s = createState(4, { moveMode: "auto" });
    s.players[0] = { x: 2, targetX: 2 };
    for (let i = 0; i < COURT.serveDelayTicks + 1; i++) step(s, []);
    expect(s.phase).toBe("rally");
    expect(s.shots).toBe(1);
    expect(s.players[0].x).toBeLessThan(2);
  });

  it("is deterministic: the same seed and inputs (mode changes included) give an identical snapshot", () => {
    const play = () => {
      const s = createState(42, { moveMode: "auto" });
      for (let i = 0; i < 60 * 60; i++) {
        const inputs: TennisInput[] = [...botInputs(s, 1).filter((x) => x.t === "swing")];
        const c = predictContact(s, 0);
        if (c && c.ticks < 10) inputs.push({ t: "swing", seat: 0, dirX: 0, kind: naturalKind(0, s.players[0].x, c.ball.x), level: 1 });
        if (i === 900) inputs.push({ t: "mode", seat: 0, mode: "tilt" });
        if (i === 1500) inputs.push({ t: "mode", seat: 0, mode: "auto" });
        step(s, inputs);
      }
      return snapshot(s);
    };
    expect(play()).toEqual(play());
  });

  it("the adapter accepts auto and tilt, rejects anything else, and takes the seat from the connection", () => {
    expect(asInput(1, { t: "mode", mode: "auto" })).toEqual({ t: "mode", seat: 1, mode: "auto" });
    expect(asInput(0, { t: "mode", mode: "tilt", seat: 1 })).toEqual({ t: "mode", seat: 0, mode: "tilt" });
    for (const mode of ["run", "", undefined, 1, null, "AUTO"]) expect(asInput(0, { t: "mode", mode })).toBeNull();
  });

  it("rewind still works with a seat in auto (ADR 001)", () => {
    // a slow, high ball reaching seat 1 in auto; it stays in play past the window
    const start = createState(7, { moveMode: "auto" });
    start.phase = "rally";
    start.lastHitter = 0;
    start.shots = 1;
    start.ball = { x: 0, y: 1.6, z: -COURT.halfL + 2, vx: 0, vy: 0, vz: -8 };
    const g = tennisFrom(start);
    const shadow = structuredClone(start);
    let onTimeAgo = -1;
    for (let t = 0; t < 120; t++) {
      if (missReason(shadow, 1) === null) onTimeAgo = 0;
      else if (onTimeAgo >= 0) onTimeAgo++;
      if (missReason(shadow, 1) === "late" && onTimeAgo === 3) break;
      g.step([]);
      step(shadow, []);
    }
    expect(missReason(shadow, 1)).toBe("late");
    const kind = naturalKind(1, shadow.players[1].x, shadow.ball.x);
    const events = g.rewind!({ seat: 1, input: { t: "swing", dirX: 0, kind, level: 1 } }, 3);
    expect(events).toContainEqual({ type: "swing", seat: 1, outcome: "hit" });
  });
});

/** The outcome of `seat` swinging `kind` right now, on a copy. */
function createSwingAt(s: TennisState, seat: Seat, kind: "forehand" | "backhand"): string {
  const c = structuredClone(s);
  const ev = step(c, [{ t: "swing", seat, dirX: 0, kind, level: 1 }]);
  const own = ev.find((e) => e.type === "swing");
  return own?.type === "swing" ? own.outcome : "none";
}

/**
 * Share of in-landing shots by seat 0 at `level` and `aim` (0 straight, 1
 * full) that an auto-moving seat 1, starting on the sideline away from where
 * the shot goes, gets in reach of with the right side.
 */
function reachRate(level: Level, aim: 0 | 1): number {
  let tries = 0;
  let reached = 0;
  for (const hx of [-3, -2, -1, 0, 1, 2, 3]) {
    for (const y of [0.6, 0.9, 1.2]) {
      for (const sign of [1, -1]) {
        const s = createState(1, { moveMode: "auto" });
        s.phase = "rally";
        s.lastHitter = 1;
        s.shots = 2;
        s.ball = { x: hx, y, z: COURT.halfL, vx: 0, vy: 0, vz: 1 };
        s.players[0] = { x: hx, targetX: hx };
        s.movement[0] = { mode: "tilt", manual: false };
        const ev = step(s, [{ t: "swing", seat: 0, dirX: aim * sign, kind: naturalKind(0, hx, hx), level }]);
        expect(ev).toContainEqual({ type: "swing", seat: 0, outcome: "hit" });
        const goes = Math.sign(s.ball.vx) || -Math.sign(hx) || 1;
        s.players[1] = { x: -goes * COURT.halfW, targetX: -goes * COURT.halfW };
        let landedIn: boolean | null = null;
        let ok = false;
        const live = s as TennisState;
        for (let i = 0; i < 400 && live.phase === "rally" && live.lastHitter === 0; i++) {
          if (missReason(s, 1, naturalKind(1, s.players[1].x, s.ball.x)) === null) ok = true;
          step(s, []);
          if (landedIn === null && s.lastBounce) landedIn = s.lastBounce.in;
        }
        // an out ball needn't be reached
        if (landedIn !== true) continue;
        tries++;
        if (ok) reached++;
      }
    }
  }
  return reached / tries;
}
