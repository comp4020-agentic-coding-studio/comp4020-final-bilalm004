import type { ClientMsg, ServerMsg } from "../../../shared/protocol.ts";
import { STAGES } from "../../../shared/games/archery/sim.ts";
import type { GameLink } from "../../net/link.ts";
import { PracticeSim } from "./practice-sim.ts";
import { startArchery } from "./view.ts";

// Archery practice (task 22): the archery view on a PracticeSim in the page,
// like tennis training's LocalLink. Nothing goes over the network. A small
// panel picks the distance and wind, or leaves them cycling.

const TICK_MS = 1000 / 60;

class PracticeLink implements GameLink {
  private handlers = new Set<(msg: ServerMsg) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticks = 0;
  readonly sim: PracticeSim;

  constructor(sim: PracticeSim) {
    this.sim = sim;
  }

  on(handler: (msg: ServerMsg) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  send(msg: ClientMsg): void {
    if (msg.t === "aim") this.sim.aim(msg);
    else if (msg.t === "release") this.sim.release(msg);
    else if (msg.t === "pause") this.sim.paused = msg.paused;
    else if (msg.t === "leave") this.stop();
  }

  emitState(): void {
    for (const h of this.handlers) h({ t: "state", state: this.sim.snapshot() });
  }

  start(): void {
    for (const h of this.handlers) h({ t: "presence", names: ["You", null], spectators: 0 });
    this.emitState();
    const startedAt = performance.now();
    let done = 0;
    // 60 Hz like a room, a state every other tick; after a stall, catch up at most 5
    this.timer = setInterval(() => {
      const due = Math.floor((performance.now() - startedAt) / TICK_MS);
      const n = Math.min(due - done, 5);
      done = due;
      for (let i = 0; i < n; i++) {
        this.sim.tick();
        if (++this.ticks % 2 === 0) this.emitState();
      }
    }, TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export function startArcheryPractice(root: HTMLElement, onExit: () => void): () => void {
  const sim = new PracticeSim((Math.random() * 2 ** 32) >>> 0);
  const link = new PracticeLink(sim);
  let view: HTMLElement | null = null;
  const stopView = startArchery(root, link, { room: "PRACTICE", game: "archery", seat: 0, practice: true }, onExit, {
    local: true,
    leaveLabel: "Done",
    onView: (v) => (view = v),
  });
  const panel = document.createElement("section");
  panel.className = "ar-practice";
  panel.setAttribute("aria-label", "Practice settings");
  panel.innerHTML = `
    <label>Distance
      <select data-pick="level">
        <option value="cycle">Cycle</option>
        ${STAGES.map((s, i) => `<option value="${i}">${s.distance} m</option>`).join("")}
      </select>
    </label>
    <label>Wind
      <select data-pick="wind">
        <option value="auto">Level's own</option>
        <option value="0">None</option>
        <option value="2">Light</option>
        <option value="5">Medium</option>
        <option value="8">Strong</option>
      </select>
    </label>
    <label>Blowing
      <select data-pick="angle">
        <option value="0">→ Right</option>
        <option value="180">← Left</option>
        <option value="90">↑ Down-range</option>
        <option value="270">↓ Toward you</option>
        <option value="45">↗ Down-range right</option>
        <option value="135">↖ Down-range left</option>
      </select>
    </label>`;
  (view as HTMLElement | null)?.append(panel);
  const level = panel.querySelector("[data-pick=level]") as HTMLSelectElement;
  const wind = panel.querySelector("[data-pick=wind]") as HTMLSelectElement;
  const angle = panel.querySelector("[data-pick=angle]") as HTMLSelectElement;
  const apply = () => {
    angle.disabled = wind.value === "auto" || wind.value === "0";
    sim.choose({
      level: level.value === "cycle" ? null : Number(level.value),
      wind: wind.value === "auto" ? null : { speed: Number(wind.value), angle: (Number(angle.value) * Math.PI) / 180 },
    });
    link.emitState();
  };
  angle.disabled = true;
  for (const s of [level, wind, angle]) s.addEventListener("change", apply);
  link.start();
  return () => {
    link.stop();
    panel.remove();
    stopView();
  };
}
