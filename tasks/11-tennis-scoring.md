# 11 Tennis scoring

Status: in progress (pure module `shared/games/tennis/scoring.ts` and unit tests done; not yet wired into the sim, protocol or HUD)
Model: Sonnet

## Goal
Real tennis scoring: 0/15/30/40, deuce and advantage, games, sets, tiebreak at
6-6, formats "oneSet" and "bestOfThree", serve alternating each game, two
serves per point (double fault loses it), no lets.

## Done
- `shared/games/tennis/scoring.ts`: `createScore`, `pointWon`, `fault`,
  `pointCalls`, `displayScore`. Pure and immutable.
- `spec/scoring.test.ts`: table-driven unit tests.

## Next
- Sim calls `fault` / `pointWon` and exposes `ScoreState` in the snapshot.
- Protocol and HUD show games, sets and calls; server persists the result.
