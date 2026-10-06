import { tennis } from "./tennis/index.ts";

export interface SeatInput {
  seat: 0 | 1;
  input: unknown;
}

export interface GameInstance {
  step(inputs: readonly SeatInput[]): void;
  snapshot(): unknown;
  finished(): { winner: 0 | 1; score: [number, number] } | null;
  botInputs(seat: 0 | 1): unknown[];
}

export interface GameDef {
  id: string;
  name: string;
  /** `endless`: no winner, play until everyone leaves (practice). */
  create(seed: number, options?: { endless?: boolean }): GameInstance;
}

export const games: Record<string, GameDef> = { tennis };
