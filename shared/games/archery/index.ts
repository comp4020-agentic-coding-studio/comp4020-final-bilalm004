import type { GameDef, GameInstance } from "../registry.ts";
import { botInputs } from "./bot.ts";
import { cloneState, createState, snapshot, step } from "./sim.ts";
import type { ArcheryInput, ArcheryState, Format, Seat } from "./sim.ts";

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Validates one seat's input. The seat comes from the connection, never the payload; the sim clamps the aim. */
export function asInput(seat: Seat, input: unknown): ArcheryInput | null {
  if (typeof input !== "object" || input === null) return null;
  const m = input as Record<string, unknown>;
  if (m.t !== "aim" && m.t !== "release") return null;
  if (!num(m.yaw) || !num(m.pitch) || !num(m.draw)) return null;
  return { t: m.t, seat, yaw: m.yaw, pitch: m.pitch, draw: m.draw };
}

/** "unlimited" plays endless random levels; anything else is the eight-stage match. */
export const asFormat = (format: unknown): Format => (format === "unlimited" ? "unlimited" : "match");

/** An archery game starting from `start`; for tests. */
export function archeryFrom(start: ArcheryState): GameInstance {
  return makeInstance(cloneState(start));
}

export const archery: GameDef = {
  id: "archery",
  name: "Archery",
  create(seed, options) {
    const format = asFormat(options?.format);
    return makeInstance(createState(seed, { format, endless: options?.endless === true || format === "unlimited" }));
  },
};

function makeInstance(s: ArcheryState): GameInstance {
  return {
    step(inputs) {
      const parsed: ArcheryInput[] = [];
      for (const { seat, input } of inputs) {
        const p = asInput(seat, input);
        if (p) parsed.push(p);
      }
      return step(s, parsed);
    },
    snapshot: () => snapshot(s),
    finished: () =>
      s.phase === "over" && s.winner !== null ? { winner: s.winner, score: [s.totals[0], s.totals[1]], format: s.format } : null,
    botInputs: (seat) => botInputs(s, seat),
  };
}
