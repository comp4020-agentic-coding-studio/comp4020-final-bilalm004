import { tennis } from "./tennis/index.ts";

export interface SeatInput {
  seat: 0 | 1;
  input: unknown;
}

export interface GameInstance {
  step(inputs: readonly SeatInput[]): void;
  snapshot(): unknown;
  finished(): { winner: 0 | 1; score: [number, number] } | null;
  botInput(seat: 0 | 1): unknown;
}

export interface GameDef {
  id: string;
  name: string;
  create(seed: number): GameInstance;
}

export const games: Record<string, GameDef> = { tennis };
