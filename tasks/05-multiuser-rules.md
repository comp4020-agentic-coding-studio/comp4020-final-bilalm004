# 05 Multi-user rules and reconnect

Status: not started (today: first two get seats, others spectate, a leaver's
seat frees immediately)
Model: Opus to decide and write the rules, Sonnet to implement

## Goal
Crit 10 asks for a written decision about multi-user behaviour. Decide it, put
it in the README and CLAUDE.md, build it, and test it.

## Decide (write each answer in one or two sentences)
- Third arrival: spectator with a queue ("winner stays on")? Or refused?
- Disconnect mid-match: grace period (suggested 15-30 s), then pause, forfeit
  or bot takeover?
- Reconnect: same token reclaims the same seat and the match resumes?
- Two tabs, one player (same token): second connection allowed? Replaces the
  first?
- Who can see what: room code only, or a public list of open rooms?
- Identity: pseudonym per token, renameable? Anything stopping impersonation?

## Done when
- [ ] Decisions written in the README (user-facing) and CLAUDE.md (rules).
- [ ] Implemented in `server/rooms.ts`, with the client showing disconnect and
      reconnect states honestly.
- [ ] Spec tests over WebSocket for: seat reclaim, grace expiry, queue order,
      duplicate token, room cleanup.
- [ ] Tested with two real simultaneous sessions, plus picking a session up
      the next day (same token, history intact).
