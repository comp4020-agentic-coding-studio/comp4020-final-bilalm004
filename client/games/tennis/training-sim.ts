import { DRILLS, feedBall, machineFeed, movementStart } from "../../../shared/games/tennis/machine.ts";
import type { Drill } from "../../../shared/games/tennis/machine.ts";
import { COURT, createState, predictContact, seatZ, step } from "../../../shared/games/tennis/sim.ts";
import type { Hand, Level, Miss, MoveMode, SwingKind, TennisEvent, TennisInput, TennisState } from "../../../shared/games/tennis/sim.ts";
import { LESSONS, TARGETS, TARGET_RADIUS, lessonProgress, wantedShot } from "./lessons.ts";
import type { LessonId, LessonRecord, ShotReport } from "./lessons.ts";
import { litTiming, windowPosition } from "./trajectory-aid.ts";

// Training (task 5): the shared tennis sim run in the page, with a ball
// machine on the far baseline instead of an opponent. No score is shown and
// nothing is stored; the sim's own score just runs on unseen. The player is
// seat 0, the machine seat 1. Deterministic: seed plus the inputs given.

// ticks between one ball being over and the machine feeding the next
export const FEED_GAP_TICKS = 50;

export type TrainingEvent =
  | { type: "swing" }
  | { type: "shot"; report: ShotReport }
  | { type: "landed"; report: ShotReport }
  | { type: "miss"; miss: Miss; kind: SwingKind }
  | { type: "progress"; lesson: LessonId; done: boolean; text: string }
  // crossX: where the ball will cross the player's baseline, if it gets there
  | { type: "feed"; x: number; crossX: number | null }
  | { type: "target"; index: number };

export interface SwingRequest {
  dirX: number;
  kind: SwingKind;
  level: Level;
  hand?: Hand;
  lift?: number;
  timingAim?: boolean;
}

export class TrainingSim {
  state: TennisState;
  hand: Hand;
  paused = false;
  private seed: number;
  private lesson: LessonId = "swing";
  private drill: Drill = "timing";
  private chosenMode: MoveMode = "auto";
  private queue: TennisInput[] = [];
  private swingMsg: SwingRequest | null = null;
  private feeds = 0;
  private machineX = 0;
  private record: LessonRecord = { swings: 0, shots: [], targets: 0 };
  // your last hit, until it lands
  private flying: { report: ShotReport; since: number } | null = null;
  private target = 0;

  /**
   * `startPaused`: the machine waits until the player is ready (the training
   * screen's setup), so balls don't fly while they set up their camera.
   */
  constructor(seed: number, hand: Hand = "right", opts: { startPaused?: boolean } = {}) {
    this.seed = seed >>> 0;
    this.hand = hand;
    this.paused = opts.startPaused === true;
    this.state = createState(this.seed, { moveMode: "auto", endless: true });
    // the machine never moves; it stands where it feeds from
    this.state.movement[1] = { mode: "tilt", manual: false };
  }

  /**
   * Back to the start: auto-move chosen again, whatever was chosen before. A
   * lean saved from an earlier session must not carry into training (user's
   * ruling: auto by default).
   */
  reset(): void {
    this.chosenMode = "auto";
    this.state.movement[0] = { mode: "auto", manual: false };
  }

  get lessonId(): LessonId {
    return this.lesson;
  }

  /**
   * What the current step asked for at the moment the last recorded shot was
   * hit: the shot wanted from the record without that shot. Null for steps
   * that ask for nothing in particular.
   */
  wantedBeforeLast(): ReturnType<typeof wantedShot> {
    if (this.lesson !== "timing" && this.lesson !== "strength") return null;
    return wantedShot(this.lesson, { ...this.record, shots: this.record.shots.slice(0, -1) });
  }

  /** The lit target circle, during the optional targets step. */
  currentTarget(): { x: number; z: number } | null {
    return this.lesson === "targets" ? TARGETS[this.target] : null;
  }

  /** Start step `id` afresh: its drill, an empty record. */
  setLesson(id: LessonId, out: TrainingEvent[] = []): TrainingEvent[] {
    this.lesson = id;
    this.drill = LESSONS.find((l) => l.id === id)?.drill ?? "mixed";
    if (!DRILLS.includes(this.drill)) this.drill = "mixed";
    this.record = { swings: 0, shots: [], targets: 0 };
    this.flying = null;
    this.target = 0;
    if (this.drill === "movement") {
      // a fresh feed for this drill: the ball in play was fed for the last step
      const s = this.state;
      s.phase = "serve";
      s.phaseTick = 0;
      s.lastHitter = null;
      s.pending = null;
    }
    out.push(this.progress());
    return out;
  }

  swing(msg: SwingRequest): void {
    // one swing per tick, as a room's cooldown would allow
    if (this.swingMsg) return;
    if (msg.hand) this.hand = msg.hand;
    this.swingMsg = msg;
    this.queue.push({ t: "swing", seat: 0, dirX: Math.max(-1, Math.min(1, msg.dirX)), kind: msg.kind, level: msg.level, hand: msg.hand, lift: msg.lift, timingAim: msg.timingAim || undefined });
  }

  move(x: number): void {
    this.queue = this.queue.filter((i) => i.t !== "move");
    this.queue.push({ t: "move", seat: 0, x });
  }

  /** The player's chosen movement mode; the movement step overrides it with "tilt" while it runs. */
  setMode(mode: MoveMode): void {
    this.chosenMode = mode;
  }

  private progress(): TrainingEvent {
    const p = lessonProgress(this.lesson, this.record);
    return { type: "progress", lesson: this.lesson, done: p.done, text: p.text };
  }

  private feed(out: TrainingEvent[]): void {
    const s = this.state;
    // (the movement drill's start position is reached by walking, in tick(); it
    // is never set here, or the player would teleport side to side)
    const f = machineFeed(this.seed, this.drill, this.feeds++, this.hand, s.players[0].x);
    this.machineX = f.x;
    s.ball = feedBall(f);
    s.phase = "rally";
    s.phaseTick = 0;
    s.lastHitter = 1;
    s.bounces = 0;
    // counted as a serve, so the view shows no stroke label for the machine
    s.shots = 1;
    s.pending = null;
    s.movement[0].manual = false;
    out.push({ type: "feed", x: f.x, crossX: predictContact(s, 0)?.ball.x ?? null });
  }

  /** One 60 Hz tick. Returns what the sim did (for the swing rulings) and what training saw. */
  tick(): { events: TennisEvent[]; training: TrainingEvent[] } {
    const out: TrainingEvent[] = [];
    if (this.paused) return { events: [], training: out };
    const s = this.state;
    const inputs = this.queue;
    this.queue = [];
    const swung = this.swingMsg;
    this.swingMsg = null;

    const want: MoveMode = this.lesson === "movement" ? "tilt" : this.chosenMode;
    if (s.movement[0].mode !== want) inputs.unshift({ t: "mode", seat: 0, mode: want });
    // The movement drill never moves the player: it feeds each ball to the side
    // away from where they are standing (machineFeed), so they have to run. A
    // forced walk back to a start position sent them from sideline to sideline
    // and fought their own keys (user's playtest).
    if (s.phase === "serve" && s.phaseTick >= FEED_GAP_TICKS) this.feed(out);
    s.players[1] = { x: this.machineX, targetX: this.machineX };

    // when in the window a swing this tick meets the ball (judged before the ball moves, as step does)
    const u = windowPosition(s, 0);
    const ballX = s.ball.x;
    const events = step(s, inputs);

    if (s.phase === "serve") {
      // between feeds the ball waits in the machine
      s.ball = { x: this.machineX, y: 1, z: seatZ(1), vx: 0, vy: 0, vz: 0 };
    }

    let changed = false;
    for (const e of events) {
      if (e.type === "swing" && e.seat === 0 && swung) {
        this.record.swings++;
        out.push({ type: "swing" });
        changed = true;
        if (e.outcome === "hit") {
          const report: ShotReport = {
            timing: swung.timingAim ? litTiming(u) : null,
            kind: swung.kind,
            hand: swung.hand ?? this.hand,
            level: swung.level,
            dirX: swung.dirX,
            landing: null,
          };
          this.record.shots.push(report);
          this.flying = { report, since: s.tick };
          out.push({ type: "shot", report: { ...report } });
        } else {
          out.push({ type: "miss", miss: e.outcome, kind: swung.kind });
        }
      }
    }

    const fly = this.flying;
    if (fly) {
      const lb = s.lastBounce;
      const net = events.some((e) => e.type === "point" && e.reason === "net");
      if (lb && lb.tick > fly.since) {
        fly.report.landing = { x: lb.x, z: lb.z, in: lb.in && lb.z < 0, net: false };
      } else if (net) {
        fly.report.landing = { x: ballX, z: 0, in: false, net: true };
      }
      if (fly.report.landing) {
        this.flying = null;
        changed = true;
        out.push({ type: "landed", report: { ...fly.report } });
        const t = this.currentTarget();
        const l = fly.report.landing;
        if (t && l.in && Math.hypot(l.x - t.x, l.z - t.z) <= TARGET_RADIUS) {
          this.record.targets++;
          this.target = (this.target + 1) % TARGETS.length;
          out.push({ type: "target", index: this.target });
        }
      } else if (s.phase === "serve") {
        // the rally ended some other way before it touched down
        this.flying = null;
      }
    }
    if (changed) out.push(this.progress());
    return { events, training: out };
  }
}

// the court's far baseline, where the machine is drawn
export const MACHINE_BASELINE = -COURT.halfL;
