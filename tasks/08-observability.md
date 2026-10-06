# 08 Server logging and stats

Status: partial (JSON log lines for room and match events, tick drift warning)
Model: Sonnet

## Goal
Crit 11 ("Fly by instruments") wants server-side logging that tells you what
the app is doing in production, and PROCESS.md should show you used it.

## Scope
- Log fields worth having: connect/disconnect with reason, reconnects, swing
  accepted/rejected with reason and latency, tick drift and loop duration,
  room lifecycle, match results, errors.
- A `/healthz` or `/stats` endpoint: rooms, players online, uptime, memory
  against the 256 MB limit.
- Don't log tokens or anything personal; test that.
- Read real logs with `flyctl logs` after a session and write down one thing
  they taught you.

## Done when
- [ ] Each event above appears in the logs during a real two-player game.
- [ ] Stats endpoint reports memory and is covered by a spec test.
- [ ] A spec test fails if a token appears in log output.
- [ ] One concrete finding from production logs is recorded in PROCESS.md.
