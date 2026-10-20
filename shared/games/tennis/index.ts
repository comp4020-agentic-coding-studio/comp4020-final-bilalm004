import type { GameDef, GameInstance } from "../registry.ts";
import { botInputs } from "./bot.ts";
import { MOVE_MODES, cloneState, createState, snapshot, step } from "./sim.ts";
import type { Hand, MatchFormat, MoveMode, Seat, SwingKind, TennisEvent, TennisInput, TennisState } from "./sim.ts";

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
  if (m.t === "mode") {
    return (MOVE_MODES as readonly unknown[]).includes(m.mode) ? { t: "mode", seat, mode: m.mode as MoveMode } : null;
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

const FORMATS: readonly unknown[] = ["oneSet", "bestOfThree"] satisfies MatchFormat[];

/** A known match format, or one set (the default) for anything else. */
export function asFormat(format: unknown): MatchFormat {
  return FORMATS.includes(format) ? (format as MatchFormat) : "oneSet";
}

/** A tennis game starting from `start` instead of a fresh serve; for tests. */
export function tennisFrom(start: TennisState): GameInstance {
  return makeInstance(cloneState(start));
}

export const tennis: GameDef = {
  id: "tennis",
  name: "Tennis",
  formats: ["oneSet", "bestOfThree", "unlimited"],
  create(seed, options) {
    return makeInstance(createState(seed, { endless: options?.endless === true, format: asFormat(options?.format), moveMode: "auto" }));
  },
};

const isCall = (e: TennisEvent): boolean => e.type === "point" || e.type === "fault";

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
      // a point or fault since then is final: never rewind across it
      if (at.before.rally !== s.rally) return null;
      const trial = cloneState(at.before);
      const first = step(trial, [...at.inputs, swing]);
      const own = first.find((e) => e.type === "swing" && e.seat === swing.seat);
      if (own?.type !== "swing" || own.outcome !== "hit") return null;
      // replay the ticks since with the inputs they had; the result replaces
      // them. Their swings were already reported; only a point is news.
      const events = [own, ...first.filter(isCall)];
      const replayed = [{ before: at.before, inputs: [...at.inputs, swing] }];
      for (let i = from + 1; i < history.length; i++) {
        replayed.push({ before: cloneState(trial), inputs: history[i].inputs });
        events.push(...step(trial, history[i].inputs).filter(isCall));
      }
      history.splice(from, replayed.length, ...replayed);
      s = trial;
      return events;
    },
    snapshot: () => snapshot(s),
    finished: () =>
      s.phase === "over"
        ? {
            winner: s.winner as Seat,
            score: [s.score.sets[0], s.score.sets[1]],
            format: s.score.format,
            sets: s.score.setScores.map(([a, b]) => [a, b]),
          }
        : null,
    botInputs: (seat) => botInputs(s, seat),
  };
}
