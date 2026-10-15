import type { Scene } from "three";
import "./aid.css";
import { LEVEL_NAMES, predictLanding } from "../../../shared/games/tennis/sim.ts";
import type { Hand, Level, Seat, SwingKind, TennisState } from "../../../shared/games/tennis/sim.ts";
import { createAidFx } from "./aid-fx.ts";
import type { AidLanding, Point3, Timing, TimingAid } from "./trajectory-aid.ts";
import { TIMINGS, litTiming, meterPosition, realArc, shownStrength, timingArcs, windowPosition, stanceHint } from "./trajectory-aid.ts";

// The trajectory aid (task 3): a timing meter along the bottom, three timing
// arcs on the court for camera timing aim, depth ticks for light/medium/hard,
// the real arc after your hit, and the strength of your last swing. A
// prediction from the shared sim only; the server decides every hit. It can
// be switched off, and nothing else reads it.

const STORAGE_KEY = "trajectory-aid";

function loadOn(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function saveOn(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // storage unavailable: the default (on) next time
  }
}

export interface AidFrame {
  /** What the screen shows: the latest server state run forward. */
  shown: TennisState;
  seat: Seat;
  hand: Hand;
  /** The camera grip held, if tracking. */
  grip: SwingKind | null;
  /** Shots are aimed by timing (camera on, timing aim): show the three arcs. */
  timingAim: boolean;
  /** Keys/mouse aim in world x, for the depth ticks when not aiming by timing. */
  aim: number;
  /** Peak speed of a camera swing in progress, and this player's level thresholds. */
  peak: number | null;
  thresholds: readonly [number, number];
}

export interface TrajectoryAid {
  /** Whether the aid is on; when it is, the old reticle and arc give way to the three arcs. */
  on(): boolean;
  /** A swing just happened at `level`: detected by the camera, or chosen with a key or button. */
  swung(level: Level, source: "camera" | "keys"): void;
  /** Per frame. Returns whether the three timing arcs are showing (the old reticle and arc hide then). */
  update(f: AidFrame | null): boolean;
  dispose(): void;
}

export function createTrajectoryAid(view: HTMLElement, scene: Scene, canvas: HTMLElement): TrajectoryAid {
  const bar = document.createElement("div");
  bar.className = "aid";
  bar.innerHTML = `
    <span class="aid-stance" role="status" aria-live="polite" hidden></span>
    <div class="aid-meter" role="img" aria-label="Timing meter: early, on time, late">
      <span data-t="early">early</span><span data-t="ontime">on time</span><span data-t="late">late</span>
      <i class="aid-mark" hidden></i>
    </div>
    <span class="aid-strength" role="status" aria-live="polite" aria-label="Strength of your last swing"></span>
    <button class="aid-toggle" type="button" aria-pressed="true" aria-label="Trajectory aid" title="Show or hide the timing meter and shot arcs">Aid</button>`;
  view.append(bar);
  const meter = bar.querySelector(".aid-meter") as HTMLElement;
  const mark = bar.querySelector(".aid-mark") as HTMLElement;
  const strengthEl = bar.querySelector(".aid-strength") as HTMLElement;
  const stanceEl = bar.querySelector(".aid-stance") as HTMLElement;
  const toggle = bar.querySelector(".aid-toggle") as HTMLButtonElement;
  const fx = createAidFx(scene);

  let on = loadOn();
  let last: Level | null = null;
  // the real arc of your last hit, kept from contact until it lands
  let real: { shots: number; path: Point3[] } | null = null;
  let cached: { key: string; aid: TimingAid | null } | null = null;
  let keyTicks: { key: string; ticks: AidLanding[] | null } | null = null;
  // every arc that has been lit, for the e2e
  const lits = new Set<Timing>();

  const render = () => {
    toggle.setAttribute("aria-pressed", String(on));
    meter.hidden = !on;
    bar.dataset.on = String(on);
    canvas.dataset.aid = on ? "on" : "off";
  };
  toggle.addEventListener("click", () => {
    on = !on;
    saveOn(on);
    render();
  });
  render();

  const clear = () => {
    fx.arcs(null, null);
    fx.ticks(null, shownStrength(last, null, [1, 2]));
    fx.real(null);
    mark.hidden = true;
    meter.dataset.lit = "";
    canvas.dataset.aidArcs = "0";
    canvas.dataset.aidLit = "";
    canvas.dataset.aidTicks = "";
    canvas.dataset.aidReal = "0";
  };

  return {
    on: () => on,

    swung(level, source) {
      last = level;
      strengthEl.textContent = `${source === "camera" ? "Detected" : "Chosen"}: ${LEVEL_NAMES[level]}`;
      strengthEl.dataset.level = LEVEL_NAMES[level];
      strengthEl.dataset.source = source;
    },

    update(f) {
      if (!on || !f) {
        clear();
        return false;
      }
      const { shown: s, seat } = f;
      const strength = shownStrength(last, f.peak, f.thresholds);

      // the real arc, from your hit until it first lands
      const mine = s.phase === "rally" && s.lastHitter === seat && s.bounces === 0 && s.pending === null;
      if (!mine) real = null;
      else if (!real || real.shots !== s.shots) real = { shots: s.shots, path: realArc(s) };
      canvas.dataset.aidReal = String(fx.real(real ? real.path : null));

      // which stroke your next swing is, and a warning when the grip you hold is wrong for the ball's side
      const stance = stanceHint(s, seat, f.hand, f.grip);
      stanceEl.hidden = stance === null;
      if (stance) {
        if (stanceEl.textContent !== stance.text) stanceEl.textContent = stance.text;
        stanceEl.dataset.wrong = String(stance.wrong);
      }
      canvas.dataset.stance = stance ? `${stance.kind}${stance.wrong ? ",wrong" : ""}` : "";

      const u = windowPosition(s, seat);
      const lit = litTiming(u);
      const pos = meterPosition(u);
      mark.hidden = pos === null;
      if (pos !== null) mark.style.left = `${pos * 100}%`;
      meter.dataset.lit = lit ?? "";
      for (const span of meter.querySelectorAll<HTMLElement>("[data-t]")) span.dataset.on = String(span.dataset.t === lit);

      let showing = false;
      let ticks: AidLanding[] | null = null;
      if (f.timingAim && !real) {
        // the three arcs: where timing sends the ball, lit for the moment it's at now
        // Worked out once per incoming shot, grip and strength: the ball's
        // flight doesn't change until someone hits it, and an arc whose moment
        // has passed keeps showing where it would have gone.
        // (a shot's vx and vz don't change in flight, bounces included)
        const key = `${s.shots}/${s.ball.vx}/${s.ball.vz}/${strength.level}/${f.hand}/${f.grip ?? Math.round(s.players[seat].x * 4)}`;
        if (!cached || cached.key !== key) cached = { key, aid: timingArcs(s, seat, strength.level, f.hand, f.grip ?? undefined) };
        const aid = cached.aid;
        canvas.dataset.aidArcs = String(fx.arcs(aid ? aid.arcs : null, lit));
        ticks = aid ? aid.ticks[TIMINGS.indexOf(lit ?? "ontime")] : null;
        showing = aid !== null;
      } else {
        canvas.dataset.aidArcs = String(fx.arcs(null, null));
        // keys and mouse aim the shot directly: ticks on the aimed shot, with the chosen strength picked
        // (only for a ball coming at you, and once per shot, aim and position: it runs every frame)
        if (!real && u !== null) {
          const key = `${s.shots}/${s.ball.vx}/${s.ball.vz}/${f.aim.toFixed(2)}/${f.hand}/${f.grip}/${Math.round(s.players[seat].x * 4)}`;
          if (!keyTicks || keyTicks.key !== key) {
            const levels = ([0, 1, 2] as const).map((l) => predictLanding(s, seat, f.aim, l, f.hand, f.grip ?? undefined));
            keyTicks = { key, ticks: levels[0].predicted ? levels.map((l) => ({ x: l.x, z: l.z, in: l.in, farSide: l.farSide })) : null };
          }
          ticks = keyTicks.ticks;
        }
      }
      fx.ticks(ticks, strength);
      canvas.dataset.aidTicks = ticks ? ticks.map((t) => t.z.toFixed(1)).join(",") : "";
      if (showing && lit) lits.add(lit);
      canvas.dataset.aidLit = showing ? (lit ?? "") : "";
      canvas.dataset.aidLits = TIMINGS.filter((t) => lits.has(t)).join(",");
      return showing;
    },

    dispose() {
      clear();
      bar.remove();
    },
  };
}
