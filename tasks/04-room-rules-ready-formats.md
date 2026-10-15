# 4 Room rules, ready-up and formats

Status: built (2026-10-15), waiting on the user's two-session playtest and the next-day pickup. Rules in `server/lobby.ts` (pure, clock injected), driven by `server/room.ts`; ready panel in `client/games/tennis/ready-panel.ts`. Agent choices below are marked and need the user's OK.
Model: Opus for the rules and the room state machine, Sonnet for UI

Depends on: 1 (formats need the scoring in the game)

## Goal
Crit 10 asks for a written decision about multi-user behaviour. Decide it, put
it in the README and CLAUDE.md, build it, and test it. The same room state
machine also stops multiplayer starting instantly: players set up their
camera, agree the rules, ready up, then play.

## Decide (write each answer in one or two sentences)
- Third arrival: **decided.** Spectator only, as today. No queue for now;
  "winner stays on" is parked (parked.md).
- Disconnect mid-match: **decided.** The seat is held and the match pauses for
  30 s. If the player returns it resumes; if not, the room closes. No forfeit
  and no bot takeover for now. Ranked results aren't affected by a room that
  closes this way (no result is recorded).
- Reconnect: **decided.** The same token reclaims the same seat within the 30 s
  and the match resumes. Show "waiting for <name>" to the other player and
  spectators, with the seconds left. Spec tests: reclaim, expiry, cleanup.
- Two tabs, one player (same token): **decided: allowed, for testing.** Both
  tabs may join the same room and take both seats. Kept covered by spec tests.
  **Which tab reclaims (agent):** a held seat goes to the next connection with
  that token that joins the room; a tab already in the room (the other seat,
  or watching) is never moved into it. A match with the same token on both
  seats is stored unrated (`isRated`), so nobody can feed themselves wins.
- Who can see what: **decided.** Invite link or room code only; no public list
  of open rooms (as today), so strangers can't join.
- Identity **(agent):** one pseudonym per token, made by the server from its
  word list ("Swift Otter 42"); not renameable for now. No free text means
  nothing to moderate and no way to type someone else's name, "Bot" or "Demo
  One". If both seats show the same name (one token on two tabs), the second
  is shown "<name> (2)". Renaming with a length and character limit can come
  with accounts (parked.md).

## Ready-up, format and unlimited mode (decided)
- Room phases: `waiting -> ready-check -> countdown (3 s) -> playing`. Each
  seat has a server-owned `ready` flag. A bot seat is always ready. Un-readying
  cancels the countdown; a disconnect un-readies the seat. Spectators are
  unaffected.
- The ready panel holds the camera check ("camera OK") and the safety notice.
  A player can ready without a camera.
- **Format is chosen by the host before play**, shown in the panel, and changing
  it clears both ready flags, so nobody starts under rules they didn't see.
  Options: one set (default), best of three, unlimited.
- **Unlimited:** no winner, counts points and best rally, not rated, ends when
  someone leaves. Rated results only come from proper formats.
- Invite links already exist and stay the way to bring someone in.

## As built (agent choices marked "agent", for the user to confirm)
- Phase `paused` added for a held seat. A reclaim gets a 3 s countdown before
  play resumes, shown in the HUD ("Back. Resuming in 3…"), not the panel.
- (agent) Before the match a disconnect frees the seat, which un-readies it;
  only a match in progress holds a seat.
- (agent) Pressing Leave mid-match ends the match at once with no result; the
  room stays open for a new opponent. Only an expired hold closes the room.
  The closed room's players and spectators go to the home screen with
  "Room ABCD closed: <name> didn't come back in time."
- (agent) Host is whoever took the first seat; if they leave before the match
  the other player becomes host. Format can't change once the match starts.
- (agent) After a finished match the room returns to the ready check for a
  rematch (same or new format); the final score stays on screen until then.
- (agent) Practice vs bot stays instant: no panel, no countdown (the bot is
  always ready and the player is the only one waiting).
- Unlimited plays one-set scoring that never ends (the sim's `endless`
  option, as practice) and the room counts points won and the longest rally;
  shown in the HUD. Stored with `winner` NULL, `format` 'unlimited',
  `best_rally`, `rated` 0: schema v3 rebuilds `matches` so `winner` can be
  NULL (SQLite can't relax NOT NULL in place).
- (agent) Wording: panel title "Waiting for an opponent" / "Ready up" /
  "Starting in 3…"; button "I'm ready" / "Not ready"; camera line "Camera off
  (optional)" / "Camera on, can't see you yet" / "Camera OK"; safety notice
  collapsed under "Before you swing" (the full notice still shows before the
  camera starts), so the Ready button fits the first screen at 390x844. HUD:
  "Paused: waiting for <name> to reconnect (27 s)".
- (agent) Before the match the timing aid, stroke line and shot label are
  hidden (no ball in play), so nothing sits under the panel.
- Protocol: client `ready {ready}` and `format {format}` (anything else is a
  bad message; a valid format from a non-host gets an error); server `lobby`
  (phase, match, format, host, seats, countdown, hold, tally) and `closed`.

## Done when
- [x] Decisions written in the README (user-facing) and CLAUDE.md (rules).
- [x] Implemented in `server/rooms.ts` (now `room.ts` + `lobby.ts`), with the
      client showing disconnect and reconnect states honestly (HUD hold line,
      closed-room message).
- [x] Spec tests over WebSocket for: seat reclaim, grace expiry, duplicate
      token, room cleanup (`spec/rooms.test.ts`; expiry and cleanup with a
      short injected grace in `spec/room-rules.test.ts`). Queue order: none,
      no queue (decided).
- [ ] Tested with two real simultaneous sessions, plus picking a session up
      the next day (same token, history intact). Needs the user.
- [x] Spec tests: ready flow, un-ready cancels countdown, disconnect un-readies,
      format change clears ready, bot always ready (`spec/lobby.test.ts`,
      `spec/room-rules.test.ts`, `spec/rooms.test.ts`).
- [x] Unlimited never records a rating change (`spec/room-rules.test.ts`,
      `spec/db.test.ts`).
- [x] e2e at both viewports (`e2e/ready.e2e.ts`, `pnpm e2e --workers=1`).
- [x] README and CLAUDE.md say the same about phases and formats.
