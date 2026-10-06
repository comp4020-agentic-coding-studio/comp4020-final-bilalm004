import type { GameDef } from "../registry.ts";
import { createState, COURT, seatZ, snapshot, step } from "./sim.ts";
import type { Seat, Swing, TennisState } from "./sim.ts";

const BOT_REACH = 2.4;

function asSwing(seat: Seat, input: unknown): Swing | null {
  if (typeof input !== "object" || input === null) return null;
  const { dirX, power } = input as Record<string, unknown>;
  if (typeof dirX !== "number" || typeof power !== "number") return null;
  if (!Number.isFinite(dirX) || !Number.isFinite(power)) return null;
  return { seat, dirX, power };
}

function botSwing(s: TennisState, seat: Seat): { dirX: number; power: number } | null {
  if (s.phase !== "rally" || s.lastHitter === seat) return null;
  const b = s.ball;
  const heading = seat === 0 ? b.vz > 0 : b.vz < 0;
  if (!heading || Math.abs(b.x) > BOT_REACH) return null;
  if (Math.abs(b.z - seatZ(seat)) > COURT.hitWindow * 0.5) return null;
  return { dirX: Math.sin(s.tick * 0.37) * 0.8, power: 0.5 };
}

export const tennis: GameDef = {
  id: "tennis",
  name: "Tennis",
  create(seed) {
    const s = createState(seed);
    return {
      step(inputs) {
        const swings: Swing[] = [];
        for (const { seat, input } of inputs) {
          const swing = asSwing(seat, input);
          if (swing) swings.push(swing);
        }
        step(s, swings);
      },
      snapshot: () => snapshot(s),
      finished: () => (s.phase === "over" ? { winner: s.winner as Seat, score: [s.score[0], s.score[1]] } : null),
      botInput: (seat) => botSwing(s, seat),
    };
  },
};
