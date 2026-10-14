# 13 Ready-up, match format, unlimited mode

Status: planned
Model: Opus for the room state machine, Sonnet for UI

Depends on: 11 (formats need the scoring module)

## Goal
Multiplayer no longer starts instantly. Players set up their camera, agree the
rules, ready up, then play.

## Decisions
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
- [ ] Spec tests: ready flow, un-ready cancels countdown, disconnect un-readies,
      format change clears ready, bot always ready.
- [ ] Unlimited never records a rating change (test).
- [ ] e2e at both viewports (`pnpm e2e --workers=1`).
- [ ] README and CLAUDE.md say the same about phases and formats.
