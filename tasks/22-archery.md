# 22 Archery

Status: built (2026-10-21): sim, rooms, view, camera gesture and practice, with specs and e2e. Waiting on a real-webcam playtest and on task 7 (ratings).
Model: Opus
Session: D

## Context
Archery follows the GamePigeon iMessage archery layout. It is already on the
home screen as a disabled "Coming soon" tile (`client/ui/menu.ts`,
`playable: false`, `archeryThumb()`); make it playable. CLAUDE.md's games rule
now names tennis and archery and keeps the registry shape.

## Decided (user, 2026-10-21)
- Own leaderboard and own Elo (task 7 keys ratings by sport id).
- **Match:** 8 stages inside one match, climbing from near with no wind to far
  with strong wind (distance and wind per stage). One arrow per player per
  stage, players alternate, the starting player swaps each stage. One shared
  board shows both players' arrows.
- **Scoring:** rings 10 to 1 plus a bullseye bonus; highest total after 8
  stages wins. A tie goes to sudden death: one arrow each at the furthest
  distance, closest to centre wins; an exact tie shoots again (Claude, in the
  build: a pair that can't tie forever is simpler than a draw result). Sudden
  death decides the winner but is not added to the score.
- **Unlimited format:** no winner, counts points and best arrow, ends when
  someone leaves, stored unrated. Distance is randomised between the levels
  each turn, and the wind re-rolled with it.
- **Input (camera):** hold like a bow. Front hand aims the sight; back hand
  pulls away from it, and draw distance is strength. Release is the back hand
  snapping back toward the front hand once drawn past a minimum; a slow return
  cancels with no arrow. A longer draw flies faster and flatter, so it spends
  less time in the wind. Keyboard and mouse are a test convenience only:
  mouse moves the sight, hold click to draw, release to fire, arrows + Space.
- **Preview:** shows where the arrow would land from aim, draw and distance,
  without wind. Reading the wind is the skill. The wind indicator shows
  strength and direction (angle).
- **Server owns** flight (gravity + seeded wind) and score; clients send aim,
  draw and release. The preview runs in the page from the same pure `shared/`
  maths with wind set to zero. Deterministic (seed + input stream). No rewind.
- **Rooms:** same modes as tennis (vs bot, two players, spectators), the
  host's format option and the rated option on the invite. Practice vs bot
  is a real match but never rated.
- **Practice button:** solo, runs in the page like tennis training
  (`training.ts`, `local-link.ts`): endless arrows on a board, cycles through
  the levels with an option to pick distance and wind, wind angle shown. No
  room, score or rating, nothing sent to the server.

## Still open
- Tuning after a playtest: stage table, wind strength (`WIND_ACCEL`), bot
  aim noise, the 30 s shot clock, the bow gesture's spans and release speed.
- Whether archery gets guided training later (not in this task).

## Done when
- [x] `shared/games/archery/` with sim, bot and adapter, registered in
      `shared/games/registry.ts`; `spec/archery-*.test.ts` sim tests.
- [x] Client view in `client/games/archery/`, both viewports, camera and keys;
      `e2e/archery.e2e.ts`.
- [x] Rooms work for it through the same server code (game-owned formats,
      `aim`/`release` messages); a finished match is recorded with
      `game: "archery"` and rated by the usual rule.
- [ ] A rated match updates the archery rating only: needs task 7, which
      keys ratings by sport id.
- [x] Practice button works with nothing sent to the server.
- [x] Menu tile becomes playable; CLAUDE.md layout, README and `spec/` agree.
- [ ] Playtest the bow gesture on a real webcam (thresholds in `bow.ts` are guesses).
