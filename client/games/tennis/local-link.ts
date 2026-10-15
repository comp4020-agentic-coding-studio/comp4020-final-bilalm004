import { snapshot } from "../../../shared/games/tennis/sim.ts";
import type { ClientMsg, ServerMsg } from "../../../shared/protocol.ts";
import type { GameLink } from "../../net/link.ts";
import type { TrainingEvent, TrainingSim } from "./training-sim.ts";

// Training's stand-in for the server connection: the same messages a room
// sends (state every other tick, a ruling on each swing, presence), answered
// by a TrainingSim in the page. Nothing goes over the network. The view
// can't tell the difference, which is the point: one renderer for both.

const TICK_MS = 1000 / 60;
const BROADCAST_EVERY = 2;
// after a stall (a background tab), catch up at most this many ticks at once
const MAX_CATCHUP_TICKS = 5;

export class LocalLink implements GameLink {
  private handlers = new Set<(msg: ServerMsg) => void>();
  private trainingHandlers = new Set<(e: TrainingEvent) => void>();
  private ticks = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private sim: TrainingSim;

  constructor(sim: TrainingSim) {
    this.sim = sim;
  }

  on(handler: (msg: ServerMsg) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** What training saw: swings, hits and their landings, misses, step progress. */
  onTraining(handler: (e: TrainingEvent) => void): () => void {
    this.trainingHandlers.add(handler);
    return () => this.trainingHandlers.delete(handler);
  }

  send(msg: ClientMsg): void {
    switch (msg.t) {
      case "swing":
        this.sim.swing(msg);
        break;
      case "move":
        this.sim.move(msg.x);
        break;
      case "mode":
        this.sim.setMode(msg.mode);
        break;
      case "pause":
        this.sim.paused = msg.paused;
        break;
      case "leave":
        this.stop();
        break;
      // hello, create, join, pong: there is no server to answer
    }
  }

  private emit(msg: ServerMsg): void {
    for (const h of this.handlers) h(msg);
  }

  emitTraining(events: readonly TrainingEvent[]): void {
    for (const e of events) for (const h of this.trainingHandlers) h(e);
  }

  /** The names a room would send: you, and the machine in the opponent's seat. */
  announce(): void {
    this.emit({ t: "presence", names: ["You", "Ball machine"], spectators: 0 });
    this.emit({ t: "state", state: snapshot(this.sim.state) });
  }

  /** Runs `n` ticks now. The clock (start) calls this; tests call it directly. */
  advance(n: number): void {
    for (let i = 0; i < n; i++) {
      this.ticks++;
      const { events, training } = this.sim.tick();
      for (const e of events) {
        if (e.type === "swing" && e.seat === 0) {
          this.emit({ t: "swing", tick: this.sim.state.tick, outcome: e.outcome, rtt: null, allowed: 0, rewind: 0 });
        }
      }
      this.emitTraining(training);
      if (this.ticks % BROADCAST_EVERY === 0) this.emit({ t: "state", state: snapshot(this.sim.state) });
    }
  }

  /** Ticks at 60 Hz from the page's clock until stopped. */
  start(): void {
    if (this.timer) return;
    this.announce();
    const startedAt = performance.now();
    let done = 0;
    this.timer = setInterval(() => {
      const due = Math.floor((performance.now() - startedAt) / TICK_MS);
      const n = Math.min(due - done, MAX_CATCHUP_TICKS);
      done = due;
      if (n > 0) this.advance(n);
    }, TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
