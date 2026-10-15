// Task 5: training mode. The ball machine, the lesson steps, the feedback
// text and the local link are pure or clock-free, so they are tested here
// without a browser. The browser flow (both viewports, keys, fake webcam, no
// network) is e2e/training.e2e.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LESSONS, lessonProgress, missFeedback, shotFeedback } from "../client/games/tennis/lessons.ts";
import type { LessonId, ShotReport } from "../client/games/tennis/lessons.ts";
import { LocalLink } from "../client/games/tennis/local-link.ts";
import { TrainingSim } from "../client/games/tennis/training-sim.ts";
import { DRILLS, feedBall, machineFeed } from "../shared/games/tennis/machine.ts";
import type { Drill } from "../shared/games/tennis/machine.ts";
import { COURT, createState, missReason, naturalKind, predictContact, step, timingAim } from "../shared/games/tennis/sim.ts";
import type { Hand, Level, SwingKind, TennisSnapshot, TennisState } from "../shared/games/tennis/sim.ts";
import type { ServerMsg } from "../shared/protocol.ts";

const HANDS: Hand[] = ["right", "left"];

/** A receiver (seat 0) in `mode` standing in the middle, with the machine's feed `i` of `drill` on its way. */
function fed(seed: number, drill: Drill, i: number, hand: Hand, mode: "auto" | "tilt" = "auto"): TennisState {
  const s = createState(seed, { moveMode: mode, endless: true });
  s.phase = "rally";
  s.lastHitter = 1;
  s.shots = 1;
  s.ball = feedBall(machineFeed(seed, drill, i, hand));
  return s;
}

/** Steps until the ball is at the middle of seat 0's hit window. */
function toContact(s: TennisState): void {
  for (let n = 0; n < 600; n++) {
    const c = predictContact(s, 0);
    if (!c || c.ticks === 0) return;
    step(s, []);
  }
}

describe("ball machine", () => {
  it("is deterministic: the same seed gives the same balls, another seed different ones", () => {
    for (const drill of DRILLS) {
      for (const hand of HANDS) {
        const a = Array.from({ length: 12 }, (_, i) => machineFeed(42, drill, i, hand));
        const b = Array.from({ length: 12 }, (_, i) => machineFeed(42, drill, i, hand));
        expect(b).toEqual(a);
        expect(a.map(feedBall)).toEqual(b.map(feedBall));
        const c = Array.from({ length: 12 }, (_, i) => machineFeed(43, drill, i, hand));
        expect(c).not.toEqual(a);
      }
    }
  });

  it("feeds from the far baseline toward the player, landing in on their half", () => {
    for (const drill of DRILLS) {
      for (let i = 0; i < 20; i++) {
        const s = fed(5, drill, i, "right");
        expect(s.ball.z).toBe(-COURT.halfL);
        expect(s.ball.vz).toBeGreaterThan(0);
        // run to the first bounce: on the player's half, in bounds
        const at = s.lastBounce;
        for (let n = 0; n < 400 && s.lastBounce === at; n++) step(s, []);
        expect(s.lastBounce?.in, `${drill} feed ${i} lands in`).toBe(true);
        expect(s.lastBounce!.z).toBeGreaterThan(0);
      }
    }
  });

  for (const hand of HANDS) {
    for (const [drill, kind] of [["forehand", "forehand"], ["backhand", "backhand"]] as const) {
      it(`${drill} drill, ${hand}-handed: auto-move sets up a ${kind} on every feed, and it connects`, () => {
        for (let i = 0; i < 30; i++) {
          const s = fed(11, drill, i, hand);
          toContact(s);
          expect(naturalKind(0, s.players[0].x, s.ball.x, hand), `feed ${i}`).toBe(kind);
          expect(missReason(s, 0, kind, hand), `feed ${i}`).toBeNull();
        }
      });
    }
  }

  it("movement drill: wide balls a player left in the middle can't reach, but can by walking", () => {
    for (let i = 0; i < 20; i++) {
      const still = fed(3, "movement", i, "right", "tilt");
      toContact(still);
      expect(missReason(still, 0), `feed ${i} out of reach from the middle`).toBe("reach");

      // walk toward where it crosses the baseline (A/D, or leaning)
      const walk = fed(3, "movement", i, "right", "tilt");
      const cross = predictContact(walk, 0)!.ball.x;
      step(walk, [{ t: "move", seat: 0, x: cross - Math.sign(cross) * 0.6 }]);
      toContact(walk);
      expect(missReason(walk, 0), `feed ${i} reachable by moving`).toBeNull();
    }
  });

  it("timing drill: early pulls the ball cross-court and late sends it down the line, both landing in", () => {
    for (const hand of HANDS) {
      for (let i = 0; i < 10; i++) {
        for (const [u, sign] of [[-0.66, -1], [0.66, 1]] as const) {
          const s = fed(9, "timing", i, hand);
          const window = () => (s.ball.z - COURT.halfL) / Math.max(COURT.hitWindow, Math.abs(s.ball.vz) * 0.32);
          for (let n = 0; n < 600 && window() < u; n++) step(s, []);
          const kind = naturalKind(0, s.players[0].x, s.ball.x, hand);
          const aim = timingAim(s.ball, 0, kind, hand);
          // early/late go opposite ways; which way depends on the grip, as the aid shows
          expect(Math.sign(aim)).toBe(sign * (kind === "forehand" ? 1 : -1) * (hand === "right" ? 1 : -1));
          const ev = step(s, [{ t: "swing", seat: 0, dirX: 0, kind, level: 1, hand, timingAim: true }]);
          expect(ev.find((e) => e.type === "swing")).toEqual({ type: "swing", seat: 0, outcome: "hit" });
          const at = s.lastBounce?.tick;
          for (let n = 0; n < 400 && s.lastBounce?.tick === at; n++) step(s, []);
          expect(s.lastBounce!.in, `${hand} feed ${i} at ${u} lands in`).toBe(true);
        }
      }
    }
  });
});

describe("shot feedback in plain words", () => {
  const level: Level = 1;
  // right-handed, seat 0 (training's seat): timing sets the direction and the
  // grip mirrors it, as `timingAim` does
  const TABLE: [ShotReport["timing"], SwingKind, string][] = [
    ["early", "forehand", "Early, cross-court to the left, medium"],
    ["ontime", "forehand", "On time, straight, medium"],
    ["late", "forehand", "Late, down the line to the right, medium"],
    ["early", "backhand", "Early, cross-court to the right, medium"],
    ["ontime", "backhand", "On time, straight, medium"],
    ["late", "backhand", "Late, down the line to the left, medium"],
  ];
  for (const [timing, kind, text] of TABLE) {
    it(`${timing} ${kind}: "${text}", then where it landed`, () => {
      const r: ShotReport = { timing, kind, hand: "right", level, dirX: 0, landing: null };
      expect(shotFeedback(r)).toBe(text);
      expect(shotFeedback({ ...r, landing: { x: 1, z: -6, in: true, net: false } })).toBe(`${text}, landed in`);
      expect(shotFeedback({ ...r, landing: { x: 5, z: -6, in: false, net: false } })).toBe(`${text}, landed out`);
      expect(shotFeedback({ ...r, landing: { x: 0, z: 0, in: false, net: true } })).toBe(`${text}, into the net`);
    });
  }

  it("a left-hander's sides mirror a right-hander's", () => {
    expect(shotFeedback({ timing: "early", kind: "forehand", hand: "left", level: 0, dirX: 0, landing: null })).toBe("Early, cross-court to the right, light");
    expect(shotFeedback({ timing: "late", kind: "backhand", hand: "left", level: 2, dirX: 0, landing: null })).toBe("Late, down the line to the right, hard");
  });

  it("a shot aimed by hand (an arrow key held) says so", () => {
    expect(shotFeedback({ timing: null, kind: "forehand", hand: "right", level: 2, dirX: -1, landing: null })).toBe("Aimed by hand to the left, hard");
  });

  it("every miss has words, and a wrong-side swing says which stroke the ball needed", () => {
    for (const miss of ["no ball", "out", "two bounces", "early", "late", "reach", "high", "wrong side"] as const) {
      expect(missFeedback(miss, "forehand").length).toBeGreaterThan(5);
    }
    expect(missFeedback("wrong side", "forehand")).toMatch(/needed a backhand/);
    expect(missFeedback("wrong side", "backhand")).toMatch(/needed a forehand/);
  });
});

describe("lesson steps", () => {
  const shot = (r: Partial<ShotReport>): ShotReport => ({ timing: "ontime", kind: "forehand", hand: "right", level: 1, dirX: 0, landing: null, ...r });
  const landed = { x: 0, z: -6, in: true, net: false };
  const out = { x: 6, z: -6, in: false, net: false };

  it("the camera check comes first, then forehand, backhand, timing, strength and movement; targets are optional", () => {
    expect(LESSONS.map((l) => l.id)).toEqual(["swing", "forehand", "backhand", "timing", "strength", "movement", "targets"]);
    expect(LESSONS.filter((l) => l.optional).map((l) => l.id)).toEqual(["targets"]);
  });

  const cases: [LessonId, { swings?: number; shots?: ShotReport[]; targets?: number }, boolean][] = [
    ["swing", { swings: 0 }, false],
    ["swing", { swings: 1 }, true],
    ["forehand", { shots: [shot({ kind: "forehand" })] }, false],
    ["forehand", { shots: [shot({ kind: "forehand" }), shot({ kind: "backhand" })] }, false],
    ["forehand", { shots: [shot({ kind: "forehand" }), shot({ kind: "forehand" })] }, true],
    ["backhand", { shots: [shot({ kind: "backhand" }), shot({ kind: "backhand" })] }, true],
    ["timing", { shots: [shot({ timing: "early", landing: landed })] }, false],
    ["timing", { shots: [shot({ timing: "early", landing: landed }), shot({ timing: "late", landing: out })] }, false],
    ["timing", { shots: [shot({ timing: "early", landing: landed }), shot({ timing: "late", landing: landed })] }, true],
    ["strength", { shots: [shot({ level: 0, landing: landed }), shot({ level: 1, landing: landed })] }, false],
    ["strength", { shots: [shot({ level: 0, landing: landed }), shot({ level: 2, landing: landed })] }, true],
    ["movement", { shots: [] }, false],
    ["movement", { shots: [shot({})] }, true],
    ["targets", { targets: 2 }, false],
    ["targets", { targets: 3 }, true],
  ];
  for (const [id, rec, done] of cases) {
    it(`${id}: ${JSON.stringify(rec).slice(0, 90)} -> ${done ? "done" : "not yet"}`, () => {
      const p = lessonProgress(id, { swings: 0, shots: [], targets: 0, ...rec });
      expect(p.done).toBe(done);
      expect(p.text.length).toBeGreaterThan(0);
    });
  }
});

/** Every message the link delivers, and a way to run it on by whole ticks with no clock. */
function linked(seed: number) {
  const sim = new TrainingSim(seed, "right");
  const link = new LocalLink(sim);
  const got: ServerMsg[] = [];
  link.on((m) => got.push(m));
  const latest = () => [...got].reverse().find((m) => m.t === "state") as { t: "state"; state: TennisSnapshot } | undefined;
  return { sim, link, got, latest };
}

/**
 * Runs the link until the ball is in the given third of the player's hit
 * window (early, on time or late), then swings as a key press does: the
 * stroke that suits the ball, aimed by timing. Returns the link's ruling.
 */
function swingAt(t: ReturnType<typeof linked>, third: "early" | "ontime" | "late", level: Level = 1, maxTicks = 900): string | null {
  const target = third === "early" ? -0.66 : third === "late" ? 0.66 : 0;
  for (let n = 0; n < maxTicks; n++) {
    t.link.advance(1);
    const s = t.sim.state;
    const heading = s.phase === "rally" && s.lastHitter === 1 && s.ball.vz > 0 && !s.pending;
    if (!heading) continue;
    const u = (s.ball.z - COURT.halfL) / Math.max(COURT.hitWindow, Math.abs(s.ball.vz) * 0.32);
    if (u < target) continue;
    const kind = naturalKind(0, s.players[0].x, s.ball.x);
    const before = t.got.length;
    t.link.send({ t: "swing", dirX: 0, kind, level, timingAim: true });
    t.link.advance(1);
    const ruling = t.got.slice(before).find((m) => m.t === "swing");
    // let the shot land before the next one
    t.link.advance(150);
    return ruling?.t === "swing" ? ruling.outcome : null;
  }
  return null;
}

describe("training runs locally: lesson steps complete from real input", () => {
  it("a full run of swings and moves sent as the view sends them completes every required step", () => {
    const t = linked(1234);
    const done: LessonId[] = [];
    t.link.onTraining((e) => {
      if (e.type === "progress" && e.done) done.push(e.lesson);
    });
    t.link.send({ t: "mode", mode: "auto" });

    // camera check: any swing
    t.sim.setLesson("swing");
    t.link.advance(5);
    t.link.send({ t: "swing", dirX: 0, kind: "forehand", level: 1, timingAim: true });
    t.link.advance(20);
    expect(done).toContain("swing");

    for (const lesson of ["forehand", "backhand"] as const) {
      t.sim.setLesson(lesson);
      for (let k = 0; k < 6 && !done.includes(lesson); k++) swingAt(t, "ontime");
      expect(done, lesson).toContain(lesson);
    }

    t.sim.setLesson("timing");
    for (let k = 0; k < 6 && !done.includes("timing"); k++) swingAt(t, k % 2 ? "late" : "early");
    expect(done).toContain("timing");

    t.sim.setLesson("strength");
    for (let k = 0; k < 6 && !done.includes("strength"); k++) swingAt(t, "ontime", k % 2 ? 2 : 0);
    expect(done).toContain("strength");

    // movement: auto-move is off for this step, whatever the player asked for
    t.sim.setLesson("movement");
    t.link.send({ t: "mode", mode: "auto" });
    t.link.advance(3);
    expect(t.sim.state.movement[0].mode).toBe("tilt");
    for (let k = 0; k < 6 && !done.includes("movement"); k++) {
      // wait for the feed, then walk to where it will cross the baseline, as A/D or a lean would
      for (let n = 0; n < 300 && !(t.sim.state.phase === "rally" && t.sim.state.lastHitter === 1); n++) t.link.advance(1);
      const c = predictContact(t.sim.state, 0);
      if (c) t.link.send({ t: "move", x: c.ball.x - Math.sign(c.ball.x) * 0.6 });
      swingAt(t, "ontime");
    }
    expect(done).toContain("movement");
    // and back to what the player chose once the step is over
    t.sim.setLesson("targets");
    t.link.advance(3);
    expect(t.sim.state.movement[0].mode).toBe("auto");
  });

  it("a hit reports the timing, stroke and strength, then where it landed", () => {
    const t = linked(77);
    const shots: ShotReport[] = [];
    const landings: ShotReport[] = [];
    t.link.onTraining((e) => {
      if (e.type === "shot") shots.push(e.report);
      if (e.type === "landed") landings.push(e.report);
    });
    t.sim.setLesson("timing");
    expect(swingAt(t, "early")).toBe("hit");
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({ timing: "early", level: 1, landing: null });
    expect(landings).toHaveLength(1);
    expect(landings[0].landing).not.toBeNull();
    expect(landings[0].landing!.z).toBeLessThan(0);
  });

  it("a miss is reported with its reason, and a swing with no ball still counts as a swing", () => {
    const t = linked(5);
    const misses: string[] = [];
    let swings = 0;
    t.link.onTraining((e) => {
      if (e.type === "miss") misses.push(e.miss);
      if (e.type === "swing") swings++;
    });
    t.link.send({ t: "swing", dirX: 0, kind: "forehand", level: 1 });
    t.link.advance(2);
    expect(swings).toBe(1);
    expect(misses).toEqual(["no ball"]);
  });

  it("pause holds the ball machine; unpausing carries on", () => {
    const t = linked(8);
    t.link.advance(10);
    t.link.send({ t: "pause", paused: true });
    t.link.advance(1);
    const tick = t.sim.state.tick;
    t.link.advance(120);
    expect(t.sim.state.tick).toBe(tick);
    t.link.send({ t: "pause", paused: false });
    t.link.advance(10);
    expect(t.sim.state.tick).toBeGreaterThan(tick);
  });

  it("speaks the view's protocol: state every other tick, the machine named, swing rulings back", () => {
    const t = linked(3);
    // tests drive advance() directly; start() only adds the page's clock
    t.link.announce();
    t.link.advance(10);
    expect(t.got.filter((m) => m.t === "state").length).toBeGreaterThanOrEqual(5);
    expect(t.got.find((m) => m.t === "presence")).toEqual({ t: "presence", names: ["You", "Ball machine"], spectators: 0 });
    // no score, no rating: nothing a room would send about a match or identity
    expect(t.got.some((m) => m.t === "welcome" || m.t === "room" || m.t === "error")).toBe(false);
  });
});

describe("training sends nothing over the network", () => {
  const original = { WebSocket: globalThis.WebSocket, fetch: globalThis.fetch, XMLHttpRequest: (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest };
  beforeEach(() => {
    const fail = vi.fn(() => {
      throw new Error("training must not use the network");
    });
    Object.assign(globalThis, { WebSocket: fail, fetch: fail, XMLHttpRequest: fail });
  });
  afterEach(() => {
    Object.assign(globalThis, original);
  });

  it("a whole lesson's play through the local link opens no socket and makes no request", () => {
    const t = linked(99);
    for (const lesson of LESSONS) {
      t.sim.setLesson(lesson.id);
      swingAt(t, "ontime");
    }
    expect(globalThis.WebSocket).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
