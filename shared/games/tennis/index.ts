import type { GameDef } from "../registry.ts";
import { botInputs } from "./bot.ts";
import { COURT, createState, snapshot, step } from "./sim.ts";
import type { Hand, Seat, SwingKind, TennisInput } from "./sim.ts";

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
    const { dirX, kind, level, hand } = m;
    if (typeof dirX !== "number" || !Number.isFinite(dirX)) return null;
    if (level !== 0 && level !== 1 && level !== 2) return null;
    if (!KINDS.includes(kind)) return null;
    if (hand !== undefined && !HANDS.includes(hand)) return null;
    return {
      t: "swing",
      seat,
      dirX: Math.max(-1, Math.min(1, dirX)),
      kind: kind as SwingKind,
      level,
      hand: hand as Hand | undefined,
    };
  }
  return null;
}

export const tennis: GameDef = {
  id: "tennis",
  name: "Tennis",
  create(seed, options) {
    const s = createState(seed, options?.endless ? null : COURT.winScore);
    return {
      step(inputs) {
        const parsed: TennisInput[] = [];
        for (const { seat, input } of inputs) {
          const p = asInput(seat, input);
          if (p) parsed.push(p);
        }
        step(s, parsed);
      },
      snapshot: () => snapshot(s),
      finished: () => (s.phase === "over" ? { winner: s.winner as Seat, score: [s.score[0], s.score[1]] } : null),
      botInputs: (seat) => botInputs(s, seat),
    };
  },
};
