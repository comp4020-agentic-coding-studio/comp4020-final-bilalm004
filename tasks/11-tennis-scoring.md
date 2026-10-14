# 11 Proper tennis scoring

Status: planned
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
- Formats: one set (default) or best of three. Unlimited is task 13.
- The server owns the score. Protocol and HUD show points as tennis calls them.
- Ratings and the `matches` table store games/sets, not the old first-to-5.

## Done when
- [ ] `shared/games/tennis/scoring.ts`: pure state + `pointWon`, with table-driven
      tests for deuce, advantage, tiebreak, set and match end, serve rotation.
- [ ] The sim hands point results to scoring; double-fault test.
- [ ] Protocol, HUD and `matches` carry the new score; README and spec agree.
- [ ] `pnpm check` green.
