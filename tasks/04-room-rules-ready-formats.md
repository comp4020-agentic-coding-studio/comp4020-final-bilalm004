# 4 Room rules, ready-up and formats

Status: not started. Today: first two get seats, others spectate, a leaver's
seat frees immediately; `spec/rooms.test.ts` covers seats, spectators and
practice-room reconnect only. The rules below still need your decisions.
Model: Opus for the rules and the room state machine, Sonnet for UI

Depends on: 1 (formats need the scoring in the game)

## Goal
Crit 10 asks for a written decision about multi-user behaviour. Decide it, put
it in the README and CLAUDE.md, build it, and test it. The same room state
machine also stops multiplayer starting instantly: players set up their
camera, agree the rules, ready up, then play.

## Decide (write each answer in one or two sentences) (write each answer in one or two sentences)
- Third arrival: spectator with a queue ("winner stays on")? Or refused?
- Disconnect mid-match: grace period (suggested 15-30 s), then pause, forfeit
  or bot takeover?
- Reconnect: same token reclaims the same seat and the match resumes?
- Two tabs, one player (same token): second connection allowed? Replaces the
  first?
- Who can see what: room code only, or a public list of open rooms?
- Identity: pseudonym per token, renameable? Anything stopping impersonation?


## Ready-up, format and unlimited mode (decided)
- Room phases: `waiting -> ready-check -> countdown (3 s) -> playing`. Each
  seat has a server-owned `ready` flag. A bot seat is always ready. Un-readying
  cancels the countdown; a disconnect un-readies the seat. Spectators are
  unaffected.
- The ready panel holds the camera check ("camera OK") and the safety notice
  from task 14. A player can ready without a camera.
- **Format is chosen by the host before play**, shown in the panel, and changing
  it clears both ready flags, so nobody starts under rules they didn't see.
  Options: one set (default), best of three, unlimited.
- **Unlimited:** no winner, counts points and best rally, not rated, ends when
  someone leaves. Rated results only come from proper formats.
- Invite links already exist and stay the way to bring someone in.


## Done when
- [ ] Decisions written in the README (user-facing) and CLAUDE.md (rules).
- [ ] Implemented in `server/rooms.ts`, with the client showing disconnect and
      reconnect states honestly.
- [ ] Spec tests over WebSocket for: seat reclaim, grace expiry, queue order,
      duplicate token, room cleanup.
- [ ] Tested with two real simultaneous sessions, plus picking a session up
      the next day (same token, history intact).
- [ ] Spec tests: ready flow, un-ready cancels countdown, disconnect un-readies,
      format change clears ready, bot always ready.
- [ ] Unlimited never records a rating change (test).
- [ ] e2e at both viewports (`pnpm e2e --workers=1`).
- [ ] README and CLAUDE.md say the same about phases and formats.
