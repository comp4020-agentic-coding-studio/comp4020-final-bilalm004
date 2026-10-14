# 1 Scoring in the game (with the storage half of the old leaderboard task)

Status: done (2026-10-15). Wired into the sim, snapshot, rooms, `matches` (schema v2) and the score bar. No format chooser yet (task 4 sends `format` on create); no leaderboard (task 7)
Model: Sonnet (well specified, table-driven tests)

## Goal
Scoring follows real tennis for everyone, guests included. A pure module in
`shared/` so it is deterministic and unit-testable.

## Decisions
- Points 0/15/30/40, deuce and advantage, games, sets, tiebreak at 6-6 (first
  to 7, win by 2; serve changes every two points).
- Serve alternates every game. Two serves per point; a second fault is a double
  fault and loses the point. No lets: a serve that clips the net and lands in is
  in play, one that lands out is a fault.
- Formats: one set (default) or best of three. Unlimited is task 4.
- The server owns the score. Protocol and HUD show points as tennis calls them.
- Ratings and the `matches` table store games/sets, not the old first-to-5.

## Done when
- [x] `shared/games/tennis/scoring.ts`: pure state + `pointWon`, with table-driven
      tests for deuce, advantage, tiebreak, set and match end, serve rotation.
- [x] The sim hands point results to scoring; double-fault test
      (`spec/sim-scoring.test.ts`).
- [x] Protocol, HUD and `matches` carry the new score; README and spec agree
      (`spec/rooms.test.ts`, `spec/db.test.ts`; README made no first-to-5 claim).
- [x] Score bar at the top of the game screen (see Score display), both viewports
      (`e2e/score-bar.e2e.ts`).
- [x] `pnpm check` green.

## As built
- A serve the receiver never touched that the server loses (net, out, own
  side) is a fault. Once the receiver has hit, everything is a rally point.
- `TennisState.rally` counts serves that ended (point or fault); rewind
  refuses to cross a change in it, since a fault leaves the points unchanged.
- `lastCall` in the snapshot (point or fault, who, why, tick) drives the bar's
  announcement; the bar diffs two server snapshots, never local state.
- Practice (`endless`) starts a new match when one is won instead of ending.
- `matches` (schema v2, `server/schema.ts`): `score0/1` are sets won, plus
  `format`, `sets` (JSON games per set), `practice`, `rated`. v1 rows are kept
  with `format = 'points5'`, unrated. **Decided:** practice against the bot is
  stored but never rated, and a match needs two players' tokens to be rated,
  so a rating can't be farmed off the bot.
- `create` takes an optional `format` (`oneSet` default, `bestOfThree`);
  anything else gets one set. Task 4 adds the chooser.

## Module API (built)
`createScore(format, firstServer)`, `pointWon(state, winner)`, `fault(state)`,
`pointCalls`, `displayScore`. Pure and immutable; `Side` is the same 0|1 as seats.

## Wiring into the sim (next)
- Keep `score` in `TennisState` (plain JSON, so it goes in the snapshot).
- Serving seat for each point is `score.server`.
- Bad serve: `score = fault(score)`. The first call sets `faults` to 1 (re-serve
  from the same side); the second awards the point itself, so don't also call
  `pointWon`. If `faults` is back to 0 afterwards, the point was lost: reset.
- Rally ends: `score = pointWon(score, winnerSide)` (resets `faults`).
- After either call, `score.winner !== null` ends the match; otherwise serve
  from `score.server`. Never mutate `score`; reassign from the return value.

## Score display
- A score bar stays at the top of the screen: both names, points as tennis calls
  them (0/15/30/40/Ad), games and sets, who is serving, and the format.
- When a point is scored, the bar announces it for about 2 s ("15-0", "Deuce",
  "Advantage", "Game", "Set", "Double fault") and the changed number pulses.
- It is driven by the server's `ScoreState` in the snapshot, never computed
  from a client claim. Respects reduced-motion (no pulse), is readable to a
  screen reader (live region), and fits 390x844 without covering the court or
  the camera dock.
