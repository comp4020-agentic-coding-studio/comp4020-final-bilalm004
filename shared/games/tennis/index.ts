import type { GameDef, GameInstance } from "../registry.ts";
import { botInputs } from "./bot.ts";
import { COURT, cloneState, createState, snapshot, step } from "./sim.ts";
import type { Hand, Seat, SwingKind, TennisInput, TennisState } from "./sim.ts";

// Past ticks kept for rewind. The room decides how far back a swing may go
// (at most 9 ticks, 150 ms); this only has to be at least that.
const HISTORY_TICKS = 12;

const KINDS: readonly unknown[] = ["forehand", "backhand"] satisfies SwingKind[];
const HANDS: readonly unknown[] = ["right", "left"] satisfies Hand[];

/** Validates one seat's input. The seat comes from the connection, never the payload. */
export function asInput(seat: Seat, input: unknown): TennisInput | null {
  if (typeof input !== "object" || input === null) return null;
  const m = input as Record<string, unknown>;
  if (m.t === "move") {
    return typeof m.x === "number" && Number.isFinite(m.x) ? { t: "move", seat, x: m.x } : null;
  }
  if (m.t === "swing") {
    const { dirX, kind, level, hand, lift, timingAim } = m;
    if (typeof dirX !== "number" || !Number.isFinite(dirX)) return null;
    if (level !== 0 && level !== 1 && level !== 2) return null;
    if (!KINDS.includes(kind)) return null;
    if (hand !== undefined && !HANDS.includes(hand)) return null;
    if (lift !== undefined && (typeof lift !== "number" || !Number.isFinite(lift))) return null;
    if (timingAim !== undefined && typeof timingAim !== "boolean") return null;
    return {
      t: "swing",
      seat,
      dirX: Math.max(-1, Math.min(1, dirX)),
      kind: kind as SwingKind,
      level,
      hand: hand as Hand | undefined,
      lift: lift === undefined ? undefined : Math.max(-1, Math.min(1, lift)),
      timingAim: timingAim === true ? true : undefined,
    };
  }
  return null;
}

/** A tennis game starting from `start` instead of a fresh serve; for tests. */
export function tennisFrom(start: TennisState): GameInstance {
  return makeInstance(cloneState(start));
}

export const tennis: GameDef = {
  id: "tennis",
  name: "Tennis",
  create(seed, options) {
    return makeInstance(createState(seed, options?.endless ? null : COURT.winScore));
  },
};

function makeInstance(initial: TennisState): GameInstance {
  let s = initial;
  // newest last: the state before each recent tick, and the inputs it got
  const history: { before: TennisState; inputs: TennisInput[] }[] = [];
  const parse = (inputs: readonly { seat: Seat; input: unknown }[]) => {
    const parsed: TennisInput[] = [];
    for (const { seat, input } of inputs) {
      const p = asInput(seat, input);
      if (p) parsed.push(p);
    }
    return parsed;
  };
  return {
    step(inputs) {
      const parsed = parse(inputs);
      history.push({ before: cloneState(s), inputs: parsed });
      if (history.length > HISTORY_TICKS) history.shift();
      return step(s, parsed);
    },
    rewind(input, ticksAgo) {
      const [swing] = parse([input]);
      if (swing?.t !== "swing" || ticksAgo < 1 || ticksAgo > history.length) return null;
      const from = history.length - ticksAgo;
      const at = history[from];
      // a point scored since then is final: never rewind across it
      if (at.before.score[0] !== s.score[0] || at.before.score[1] !== s.score[1]) return null;
      const trial = cloneState(at.before);
      const first = step(trial, [...at.inputs, swing]);
      const own = first.find((e) => e.type === "swing" && e.seat === swing.seat);
      if (own?.type !== "swing" || own.outcome !== "hit") return null;
      // replay the ticks since with the inputs they had; the result replaces
      // them. Their swings were already reported; only a point is news.
      const events = [own, ...first.filter((e) => e.type === "point")];
      const replayed = [{ before: at.before, inputs: [...at.inputs, swing] }];
      for (let i = from + 1; i < history.length; i++) {
        replayed.push({ before: cloneState(trial), inputs: history[i].inputs });
        events.push(...step(trial, history[i].inputs).filter((e) => e.type === "point"));
      }
      history.splice(from, replayed.length, ...replayed);
      s = trial;
      return events;
    },
    snapshot: () => snapshot(s),
    finished: () => (s.phase === "over" ? { winner: s.winner as Seat, score: [s.score[0], s.score[1]] } : null),
    botInputs: (seat) => botInputs(s, seat),
  };
}
