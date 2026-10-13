import { tennis } from "./tennis/index.ts";

export interface SeatInput {
  seat: 0 | 1;
  input: unknown;
}

/** Something a step did, for logs and replies. `seat` set means it concerns that player. */
export interface GameEvent {
  type: string;
  seat?: 0 | 1;
  [field: string]: unknown;
}

export interface GameInstance {
  step(inputs: readonly SeatInput[]): GameEvent[];
  /**
   * Lag compensation (ADR 001): play `input` as if it had arrived `ticksAgo`
   * ticks ago, then replay to now. Applied only if it connects there and no
   * point was scored since; returns null otherwise and leaves the game as it
   * was, so the caller judges the input now instead.
   */
  rewind?(input: SeatInput, ticksAgo: number): GameEvent[] | null;
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
