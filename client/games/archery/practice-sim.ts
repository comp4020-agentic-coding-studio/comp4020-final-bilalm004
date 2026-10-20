import { STAGES, createState, flyStep, launch, scoreHit, snapshot } from "../../../shared/games/archery/sim.ts";
import type { Aim, ArcheryState, Shot, Wind } from "../../../shared/games/archery/sim.ts";

// Archery practice (task 22): one archer, endless arrows, in the page. It
// reuses the sim's flight and scoring but not its match: levels cycle every
// few arrows, or stay on the one the player picked. No room, no score kept,
// nothing sent anywhere. Pure apart from the seed, so it is tested
// (spec/archery-practice.test.ts).

/** Arrows at each level before cycling to the next. */
export const ARROWS_PER_LEVEL = 3;
/** The landed arrow stays this long before the next. */
const RESULT_TICKS = 60;

export interface PracticePick {
  /** Index into STAGES, or null to cycle. */
  level: number | null;
  /** Wind speed m/s and the angle it blows toward (radians), or null for the level's own random wind. */
  wind: Wind | null;
}

export class PracticeSim {
  state: ArcheryState;
  pick: PracticePick = { level: null, wind: null };
  /** Arrows shot at the current level. */
  private atLevel = 0;
  private level = 0;
  paused = false;

  constructor(seed: number) {
    this.state = createState(seed, { endless: true });
    this.state.turn = 0;
    this.setLevel(0);
  }

  private random(): number {
    // the sim's own generator lives in its state; reuse it the same way
    const s = this.state;
    s.rng = (s.rng + 0x6d2b79f5) >>> 0;
    let t = s.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private setLevel(level: number): void {
    const s = this.state;
    this.level = level;
    this.atLevel = 0;
    s.stage = level;
    s.distance = STAGES[level].distance;
    this.rollWind();
  }

  private rollWind(): void {
    const max = STAGES[this.level].maxWind;
    this.state.wind = this.pick.wind
      ? { ...this.pick.wind }
      : max > 0
        ? { speed: Math.round(max * (0.5 + 0.5 * this.random()) * 10) / 10, angle: this.random() * Math.PI * 2 }
        : { speed: 0, angle: 0 };
  }

  /** Pick a level and wind (or null to cycle / roll them). Starts the next arrow there. */
  choose(pick: PracticePick): void {
    this.pick = { level: pick.level, wind: pick.wind ? { ...pick.wind } : null };
    this.setLevel(pick.level ?? this.level);
    this.startTurn();
  }

  private startTurn(): void {
    const s = this.state;
    s.phase = "aim";
    s.phaseTick = 0;
    s.arrow = null;
    s.aim = { yaw: 0, pitch: 0, draw: 0 };
  }

  aim(a: Aim): void {
    if (this.state.phase !== "aim") return;
    this.state.aim = { ...a };
  }

  release(a: Aim): void {
    const s = this.state;
    if (s.phase !== "aim" || a.draw < 0.2) return;
    s.aim = { ...a };
    const { pos, vel } = launch(a);
    s.arrow = { pos, vel, ticks: 0 };
    s.phase = "flight";
    s.phaseTick = 0;
  }

  /** One tick; returns the shot if an arrow landed. */
  tick(): Shot | null {
    const s = this.state;
    if (this.paused) return null;
    s.tick++;
    s.phaseTick++;
    if (s.phase === "flight" && s.arrow) {
      s.arrow.ticks++;
      const r = flyStep(s.arrow, s.distance, s.wind);
      if (r.kind === "flying" && s.arrow.ticks < 600) return null;
      const hit = r.kind === "hit" ? r.hit : null;
      const { points, bullseye } = scoreHit(hit);
      const shot: Shot = { seat: 0, stage: s.stage, distance: s.distance, hit, points, bullseye, ...(hit ? {} : { lost: "short" as const }) };
      s.shots.push(shot);
      if (s.shots.length > 30) s.shots.shift();
      s.totals[0] += points;
      s.best[0] = Math.max(s.best[0], points);
      s.phase = "result";
      s.phaseTick = 0;
      return shot;
    }
    if (s.phase === "result" && s.phaseTick >= RESULT_TICKS) {
      this.atLevel++;
      if (this.pick.level === null && this.atLevel >= ARROWS_PER_LEVEL) this.setLevel((this.level + 1) % STAGES.length);
      else this.rollWind();
      this.startTurn();
    }
    return null;
  }

  snapshot() {
    return snapshot(this.state);
  }
}
