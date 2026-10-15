// Task 5: training mode. The ball machine, the lesson steps, the feedback
// text and the local link are pure or clock-free, so they are tested here
// without a browser. The browser flow (both viewports, keys, fake webcam, no
// network) is e2e/training.e2e.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LESSONS, MOVEMENT_OFFER, REQUIRED_LESSONS, afterLesson, lessonProgress, missFeedback, shotFeedback, trainingComplete } from "../client/games/tennis/lessons.ts";
import type { LessonId, ShotReport } from "../client/games/tennis/lessons.ts";
import { LocalLink } from "../client/games/tennis/local-link.ts";
import { TrainingSim } from "../client/games/tennis/training-sim.ts";
import { DRILLS, feedBall, machineFeed, movementStart } from "../shared/games/tennis/machine.ts";
import type { Drill } from "../shared/games/tennis/machine.ts";
import { COURT, PLAYER, createState, missReason, naturalKind, predictContact, step, timingAim } from "../shared/games/tennis/sim.ts";
import type { Hand, Level, SwingKind, TennisSnapshot, TennisState } from "../shared/games/tennis/sim.ts";
import type { ServerMsg } from "../shared/protocol.ts";

const HANDS: Hand[] = ["right", "left"];

/** A receiver (seat 0) in `mode` standing in the middle, with the machine's feed `i` of `drill` on its way. */
function fed(seed: number, drill: Drill, i: number, hand: Hand, mode: "auto" | "tilt" = "auto", playerX = 0): TennisState {
  const s = createState(seed, { moveMode: mode, endless: true });
  s.players[0] = { x: playerX, targetX: playerX };
  s.phase = "rally";
  s.lastHitter = 1;
  s.shots = 1;
  s.ball = feedBall(machineFeed(seed, drill, i, hand, playerX));
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

  // docs/reaction-time.md: from the middle every in-bounds ball is reachable
  // even in auto, so a movement drill that starts there teaches nothing. It
  // starts the player out of position, near one sideline, and feeds the other.
  it("movement drill: starts you near a sideline and feeds the far side, so standing still always misses and running reaches it", () => {
    for (const hand of HANDS) {
      for (let i = 0; i < 30; i++) {
        const start = movementStart(i);
        expect(Math.abs(start), "near a sideline").toBeGreaterThanOrEqual(3.5);
        const at = (mode: "auto" | "tilt") => {
          const s = fed(3, "movement", i, hand, mode, start);
          return s;
        };
        const still = at("tilt");
        const cross = predictContact(still, 0)!.ball.x;
        expect(Math.sign(cross), `feed ${i} goes to the other side`).toBe(-Math.sign(start));
        expect(Math.abs(cross - start) - PLAYER.reach, `feed ${i} needs a run of over 3 m`).toBeGreaterThan(3);
        toContact(still);
        expect(missReason(still, 0), `feed ${i}: standing still misses`).toBe("reach");

        // run (A/D or a lean, 5 m/s) to 0.6 m short of where it crosses
        const run = at("tilt");
        step(run, [{ t: "move", seat: 0, x: cross + Math.sign(start) * 0.6 }]);
        toContact(run);
        expect(missReason(run, 0), `feed ${i} reachable by running`).toBeNull();
      }
    }
  });

  it("movement drill: from there, auto-move's slower walk misses some balls a full-speed run reaches", () => {
    let autoMissed = 0;
    for (let i = 0; i < 30; i++) {
      const s = fed(3, "movement", i, "right", "auto", movementStart(i));
      toContact(s);
      if (missReason(s, 0) !== null) autoMissed++;
    }
    expect(autoMissed).toBeGreaterThan(0);
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

  it("the camera check comes first, then forehand, backhand, timing and strength; movement and targets are optional", () => {
    expect(LESSONS.map((l) => l.id)).toEqual(["swing", "forehand", "backhand", "timing", "strength", "movement", "targets"]);
    expect(REQUIRED_LESSONS.map((l) => l.id)).toEqual(["swing", "forehand", "backhand", "timing", "strength"]);
    expect(LESSONS.filter((l) => l.optional).map((l) => l.id)).toEqual(["movement", "targets"]);
  });

  it("after the required steps, training is complete and offers moving yourself (auto-move is on)", () => {
    const all = new Set<LessonId>(REQUIRED_LESSONS.map((l) => l.id));
    expect(afterLesson("swing")).toEqual({ next: "forehand" });
    // a skipped step is not done, but the next one still follows
    expect(afterLesson("forehand")).toEqual({ next: "backhand" });
    expect(afterLesson("strength")).toEqual({ offer: "movement" });
    // the offer comes once: after movement (or a no thanks) it is the end
    expect(afterLesson("movement")).toEqual({ finished: true });
    expect(afterLesson("targets")).toEqual({ finished: true });
    expect(trainingComplete(all)).toBe(true);
    expect(trainingComplete(new Set<LessonId>(["swing", "forehand", "backhand", "timing"]))).toBe(false);
    expect(MOVEMENT_OFFER.question).toBe("Auto-move is on. Want to practise moving yourself?");
    expect(MOVEMENT_OFFER.yes).toBe("Yes");
    expect(MOVEMENT_OFFER.no).toBe("No thanks");
  });

  it("timing, strength and movement each explain why in two or three short sentences, consistent with docs/reaction-time.md", () => {
    const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter(Boolean).length;
    for (const id of ["timing", "strength", "movement"] as const) {
      const why = LESSONS.find((l) => l.id === id)!.why!;
      expect(why, id).toBeTruthy();
      expect(sentences(why), `${id}: ${why}`).toBeGreaterThanOrEqual(2);
      expect(sentences(why), `${id}: ${why}`).toBeLessThanOrEqual(3);
      expect(why.length, id).toBeLessThan(330);
    }
    const timing = LESSONS.find((l) => l.id === "timing")!.why!;
    expect(timing).toMatch(/early/i);
    expect(timing).toMatch(/late/i);
    expect(timing).toMatch(/run/i);
    // the measured flight times (docs/reaction-time.md): 1.98, 1.57, 1.22 s
    const strength = LESSONS.find((l) => l.id === "strength")!.why!;
    expect(strength).toMatch(/2\.0 s/);
    expect(strength).toMatch(/1\.6 s/);
    expect(strength).toMatch(/1\.2 s/);
    const movement = LESSONS.find((l) => l.id === "movement")!.why!;
    expect(movement).toMatch(/out of position/i);
    // "Not measured yet" in the doc: no claims about human reaction delay
    for (const l of LESSONS) expect(l.why ?? "").not.toMatch(/reaction delay|milliseconds|ms\b/i);
  });

  const cases: [LessonId, { swings?: number; shots?: ShotReport[]; targets?: number }, boolean][] = [
    ["swing", { swings: 0 }, false],
    ["swing", { swings: 1 }, true],
    ["forehand", { shots: [shot({ kind: "forehand" })] }, false],
    ["forehand", { shots: [shot({ kind: "forehand" }), shot({ kind: "backhand" })] }, false],
    ["forehand", { shots: [shot({ kind: "forehand" }), shot({ kind: "forehand" })] }, true],
    ["backhand", { shots: [shot({ kind: "backhand" }), shot({ kind: "backhand" })] }, true],
    ["timing", { shots: [shot({ timing: "early", landing: landed })] }, false],
    ["timing", { shots: [shot({ timing: "early", landing: landed }), shot({ timing: "late", landing: landed })] }, false],
    ["timing", { shots: [shot({ timing: "early", landing: landed }), shot({ timing: "ontime", landing: landed }), shot({ timing: "late", landing: out })] }, false],
    ["timing", { shots: [shot({ timing: "early", landing: landed }), shot({ timing: "ontime", landing: landed }), shot({ timing: "late", landing: landed })] }, true],
    // aimed by hand doesn't count: the step is about timing
    ["timing", { shots: [shot({ timing: "early", landing: landed }), shot({ timing: null, landing: landed }), shot({ timing: "late", landing: landed })] }, false],
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
    const thirds = ["early", "ontime", "late"] as const;
    for (let k = 0; k < 9 && !done.includes("timing"); k++) swingAt(t, thirds[k % 3]);
    expect(done).toContain("timing");

    t.sim.setLesson("strength");
    for (let k = 0; k < 6 && !done.includes("strength"); k++) swingAt(t, "ontime", k % 2 ? 2 : 0);
    expect(done).toContain("strength");
    // auto-move stayed on through every required step
    expect(t.sim.state.movement[0].mode).toBe("auto");

    // the optional movement drill (only on "Yes"): auto-move is off, and each
    // ball starts you near a sideline; running there with moves hits it
    t.sim.setLesson("movement");
    t.link.send({ t: "mode", mode: "auto" });
    t.link.advance(3);
    expect(t.sim.state.movement[0].mode).toBe("tilt");
    for (let k = 0; k < 6 && !done.includes("movement"); k++) {
      for (let n = 0; n < 300 && !(t.sim.state.phase === "rally" && t.sim.state.lastHitter === 1); n++) t.link.advance(1);
      // out of position when the ball leaves the machine
      expect(Math.abs(t.sim.state.players[0].x)).toBeGreaterThan(3);
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
