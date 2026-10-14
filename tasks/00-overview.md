# Tasks

Final due noon Mon 9 Nov 2026. Each crit is marked on its own, so every crit
state has to hold together (README, CLAUDE.md and spec agree). Marks: process
50%, deployed app 25%, response to the brief 25%.

Model: **Opus** for judgment, design and the room rules; **Sonnet** for
well-specified implementation. Run agents on `opus` for design-heavy work.

## Open work, in build order

One flat list. Start at the top; a task only waits on the ones named.

| # | Task | Waits on | Model |
|---|------|----------|-------|
| 1 | [Scoring in the game](01-scoring-in-game.md): wire real tennis scoring into the sim, the top score bar with point announcements, games and sets stored (done) | - | Opus |
| 2 | [Auto-move](02-auto-move.md): the server moves you to the ball (done) | - | Opus then Sonnet |
| 3 | [Trajectory aid](03-trajectory-aid.md): three arcs, timing meter, detected-strength readout | - | Opus then Sonnet |
| 4 | [Room rules, ready-up and formats](04-room-rules-ready-formats.md): seats, reconnect, ready check, one set / best of three / unlimited | 1, and your rule decisions | Opus then Sonnet |
| 5 | [Training mode](05-training-mode.md): the camera onboarding | 2, 3 | Opus then Sonnet |
| 6 | [Forehand and backhand look different](06-stroke-animation.md) | - | Sonnet |
| 7 | [Leaderboard and ratings](07-leaderboard-ratings.md) | 1, 4 | Sonnet |
| 8 | [Server logging and stats](08-stats-logging.md) | - | Sonnet |
| 9 | [Menu, accessibility and polish](09-menu-accessibility.md) | 4 | Sonnet |
| 10 | [README](10-readme.md): check claims, screenshots, rewrite per crit | 4 | Opus |
| 11 | [Ship](11-ship.md): push, make the repo public, CI green, tag | - | Sonnet |
| 12 | [Rally fixes](12-rally-fixes.md): out balls, dead ball, wider hit window (done) | 2 | Opus |
| 13 | [Wii-style home screen](13-home-screen.md): title, sport thumbnail, themed sport buttons (done) | - | Opus |
| 14 | [Weblympics colours and logo](14-brand-and-logo.md): Olympic colours, a fun logo | - | Opus |
| 15 | [Game pages, recorded thumbnails, webcam by default](15-game-pages-and-thumbnails.md) | 4, 5 | Opus |
| 16 | [Point-scored banner and reaction effects](16-point-scored-banner.md) | - | Opus |

Not numbered:
- [parked.md](parked.md): accounts and profiles, room codes, double-swing cooldown.
- [yours-process-evidence.md](yours-process-evidence.md): your own work. Agents
  don't edit `PROCESS.md` or the reflections; they only append devlog entries.
- [done/](done/): shot rules, camera setup, webcam input, netcode feel, spec
  coverage rule. Files in there still say "task 12" and so on; those are the
  old numbers (map below).

Can run in parallel (different files): 1 with 3, 6 and 8. 2 shares `sim.ts`
and the protocol with 1, so run it after 1. Run each in its own worktree,
merge in one pass on an integration branch, run `pnpm check` and
`pnpm e2e --workers=1` there, and only then fast-forward `main`.

## Old numbers (the devlog and done/ files use these)

These are the numbers from before the renumbering. Tasks 12 and 13 above are new
tasks (rally fixes, home screen) and are not the old 12 and 13 below.

| Old | Now |
|---|---|
| 01 README | 10 |
| 02 deploy | 11 (first deploy is done; push, public, CI, tag are open) |
| 03 webcam input | done/webcam-input.md |
| 04 netcode feel | done/netcode-feel.md |
| 05 multi-user rules | 4 |
| 06 persistence and leaderboard | storage half in 1, leaderboard in 7 |
| 07 spec coverage | done/spec-coverage.md (a rule on every task, not a job) |
| 08 observability | 8 |
| 09 UI polish | 9 |
| 10 process evidence | yours-process-evidence.md |
| 11 tennis scoring | 1 (the scoring module itself is done) |
| 12 shot rules | done/shot-rules.md (strength readout moved to 3) |
| 13 ready-up and formats | 4 |
| 14 camera setup | done/camera-setup.md (stroke animation moved to 6) |
| 15 auto-move | 2 |
| 16 trajectory aid | 3 |
| 17 training mode | 5 |
| 18 later | parked.md |

## Rules for these files

- A task is done when its "Done when" list is true and checked, not when the
  code exists.
- Update the status line in the file when you finish or change scope.
- When a crit's spec or the brief changes a task, edit the file; don't add a
  second one.
