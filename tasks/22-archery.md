# 22 Archery

Status: not started. To be planned with the user in its own terminal session
(session D); nothing below is decided except what is marked.
Model: Opus
Session: D

## Context
CLAUDE.md says tennis is the only game until the core is solid, and not to add
a second one unless asked. The user has now asked: archery gets its own session.
When it starts, update that CLAUDE.md rule so it says archery is allowed, and
keep the registry shape so more can slot in.

Archery already exists on the home screen as a disabled "Coming soon" tile
(`client/ui/menu.ts`, `playable: false`, `archeryThumb()`).

## Decided (user, 2026-10-21)
- Archery is its own session, planned with the user in that terminal.
- It will have its own leaderboard and its own Elo rating (task 7 keys ratings
  by sport id).

## To settle with the user in that session
- Rules and scoring: rounds, arrows per round, target rings and points, one
  target or head to head, ranged by distance.
- Input: how the camera aims and releases (draw back, hold, release), and the
  keyboard and mouse equivalent. Every camera action needs one.
- Players: one vs bot, two players in a room, spectators; how the room's ready,
  format and rated option apply.
- What the server owns: the arrow's flight and the score. Clients send only
  aim and release events. Deterministic (seed + input stream) so it can be
  tested.
- Which of tennis's room, lobby, reconnect and scoring pieces are reused through
  the registry and which are tennis-only.

## Done when (to be refined)
- [ ] `shared/games/archery/` with sim, bot and adapter, registered in
      `shared/games/registry.ts`; sim unit tests.
- [ ] Client view in `client/games/archery/`, both viewports, camera and keys.
- [ ] Rooms work for it through the same server code; a rated match updates the
      archery rating only.
- [ ] Menu tile becomes playable; CLAUDE.md, README and `spec/` agree.
