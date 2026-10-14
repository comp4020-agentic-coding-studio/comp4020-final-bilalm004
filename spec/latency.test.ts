import { describe, expect, it } from "vitest";
import { tennisFrom } from "../shared/games/tennis/index.ts";
import { COURT, DT, HIT_WINDOW_S, createState, naturalKind } from "../shared/games/tennis/sim.ts";
import type { TennisSnapshot, TennisState } from "../shared/games/tennis/sim.ts";
import { TICK_MS, rewindTicks } from "../server/rewind.ts";

// How often a swing that is on time on the player's own screen still hits,
// with lag. Runs the real sim and the server's rewind rule, with the network
// modelled in ticks: the player sees a state `down` ticks old, and their swing
// reaches the server `up` ticks after they make it. Deterministic and fast, so
// it runs with every check.

const SWINGS = 400;
const WINDOW_TICKS = Math.floor(HIT_WINDOW_S / DT);
// A real player isn't frame-perfect: swing timing spread evenly across the
// whole window as seen on their own screen. All of these hit with no lag.
const SPREAD_TICKS = WINDOW_TICKS - 1;

/** A rally ball coming at seat 1 at a typical medium-shot speed. */
function incoming(i: number): TennisState {
  const s = createState(1000 + i);
  s.phase = "rally";
  s.lastHitter = 0;
  s.shots = 1;
  const x = ((i * 7) % 11) / 10 - 0.5;
  // bounces in about 0.5 m short of the baseline (task 12: an out ball is dead once it lands)
  s.ball = { x, y: 1.1, z: -COURT.halfL + 8, vx: 0, vy: 0.5, vz: -14 };
  s.players[1] = { x, targetX: x };
  return s;
}

/** Ticks until `s`'s ball reaches seat 1's baseline. */
function ticksToBaseline(s: TennisSnapshot): number {
  return Math.round((s.ball.z + COURT.halfL) / -s.ball.vz / DT);
}

/**
 * One swing at one incoming ball. The player swings `offset` ticks from the
 * moment the ball reaches the baseline on their screen. Returns the server's
 * ruling, or "no ball" if the point was already over when the swing arrived.
 */
function oneSwing(i: number, offset: number, down: number, up: number, rewind: boolean): string {
  const g = tennisFrom(incoming(i));
  const shown: TennisSnapshot[] = [g.snapshot() as TennisSnapshot];
  // the ball reaches the baseline on screen `down` ticks after it does on the server
  const swingAt = ticksToBaseline(shown[0]) + down + offset;
  for (let t = 0; t < swingAt + up; t++) {
    g.step([]);
    shown.push(g.snapshot() as TennisSnapshot);
  }
  const now = shown[shown.length - 1];
  const onScreen = shown[swingAt - down].tick;
  const kind = naturalKind(1, now.players[1].x, now.ball.x);
  const input = { seat: 1 as const, input: { t: "swing", dirX: 0, kind, level: 1 } };
  const rtt = (down + up) * TICK_MS;
  const back = rewind ? rewindTicks(now.tick, onScreen, rtt) : 0;
  const ruled = (back > 0 ? g.rewind!(input, back) : null) ?? g.step([input]);
  const own = ruled.find((e) => e.type === "swing" && e.seat === 1);
  return own ? String(own.outcome) : "no ball";
}

function hitRate(rttMs: number, rewind: boolean): { rate: number; misses: Record<string, number> } {
  const half = Math.round(rttMs / 2 / TICK_MS);
  let hits = 0;
  const misses: Record<string, number> = {};
  for (let i = 0; i < SWINGS; i++) {
    const offset = -SPREAD_TICKS + Math.round((2 * SPREAD_TICKS * i) / (SWINGS - 1));
    const outcome = oneSwing(i, offset, half, half, rewind);
    if (outcome === "hit") hits++;
    else misses[outcome] = (misses[outcome] ?? 0) + 1;
  }
  return { rate: hits / SWINGS, misses };
}

describe("latency: swings within the window on the player's screen", () => {
  it("all hit with no lag (the model itself is sound)", () => {
    expect(hitRate(0, false).rate).toBe(1);
  });

  it("without rewind, 150 ms of lag turns on-screen hits into misses", () => {
    expect(hitRate(150, false).rate).toBeLessThan(0.85);
  });

  it("with rewind, at least 95% still hit at 150 ms (ADR 001)", () => {
    expect(hitRate(150, true).rate).toBeGreaterThanOrEqual(0.95);
  });

  it("rewind changes nothing with no lag", () => {
    expect(hitRate(0, true).rate).toBe(1);
  });

  it("prints the table for PROCESS.md", () => {
    const rows = [0, 50, 100, 150, 200].map((rtt) => ({
      rtt,
      off: hitRate(rtt, false).rate,
      on: hitRate(rtt, true).rate,
    }));
    for (const r of rows) console.log(`latency rtt=${r.rtt}ms rewind off=${r.off.toFixed(3)} on=${r.on.toFixed(3)}`);
    // rewind never makes it worse
    for (const r of rows) expect(r.on).toBeGreaterThanOrEqual(r.off);
  });
});

