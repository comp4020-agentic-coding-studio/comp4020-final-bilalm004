# 7 Leaderboard and ratings

Status: partial (players and match results are stored with sets, games, format and a `rated` flag, schema v2 from task 1; nothing reads them yet). Unlimited matches (task 4) must be stored unrated
Model: Sonnet

## Goal
Give people a reason to come back tomorrow, and prove data survives restarts
and redeploys.

## Scope
- Rating (Elo) updated when a match ends; show on profile and lobby.
- Match history per player and longest-rally record (needs rally length in the
  sim state).
- Leaderboard view live-updating when a match finishes.
- Rename pseudonym (limits on length and characters).
- Schema migrations: a version table, so a redeploy with new columns works on
  the existing volume.

## Done when
- [ ] Finish a match, restart the server, rating and history are still there
      (spec test that restarts the app, or documented manual check plus a
      DB-level test).
- [ ] Leaderboard updates in a second session within about a second.
- [x] Migration test: open a DB made by the previous schema version
      (`spec/db.test.ts`, done in task 1 with the schema version table).
- [x] Practice-vs-bot matches don't affect ratings (decide and test): decided
      in task 1, stored with `rated = 0` (`spec/db.test.ts`). The rating
      code itself must read only `rated = 1` rows.
