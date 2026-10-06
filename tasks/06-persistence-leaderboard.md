# 06 Persistence and leaderboard

Status: partial (players and match results are stored; nothing reads them yet)
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
- [ ] Migration test: open a DB made by the previous schema version.
- [ ] Practice-vs-bot matches don't affect ratings (decide and test).
