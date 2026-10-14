# Tasks

Final due noon Mon 9 Nov 2026. Each crit is marked on its own, so every crit
state has to hold together (README, CLAUDE.md and spec agree). Marks: process
50%, deployed app 25%, response to the brief 25%.

Model column: **Opus** for judgment, design and writing the marker reads;
**Sonnet** for well-specified implementation.

| # | Task | Crit | Model | Depends on |
|---|------|------|-------|------------|
| 01 | [README: what "good" means](01-readme-good.md) | 9, rewrite 10, 11 | Opus | - |
| 02 | [First deploy and ship](02-deploy-ship.md) | 9 | Sonnet | - |
| 03 | [Webcam swing input](03-webcam-input.md) | 10 | Opus then Sonnet | - |
| 04 | [Netcode feel](04-netcode-feel.md) (ADR 001) | 10 | Opus | - |
| 05 | [Multi-user rules and reconnect](05-multiuser-rules.md) | 10 | Opus then Sonnet | 01 |
| 06 | [Persistence and leaderboard](06-persistence-leaderboard.md) | 10-11 | Sonnet | 05 |
| 07 | [Spec coverage](07-spec-coverage.md) | every crit | Sonnet | alongside 03-06 |
| 08 | [Server logging and stats](08-observability.md) | 11 | Sonnet | - |
| 09 | [UI, accessibility and polish](09-ui-polish.md) | 11-12 | Sonnet | 03, 05 |
| 10 | [Process evidence](10-process-evidence.md) | every crit | Opus | ongoing |
| 11 | [Proper tennis scoring](11-tennis-scoring.md) | - | Sonnet | - |
| 12 | [Shot rules: strength, height, timing, wrong side](12-shot-rules.md) | - | Opus then Sonnet | - |
| 13 | [Ready-up, match format, unlimited](13-ready-and-formats.md) | - | Opus then Sonnet | 11 |
| 14 | [Camera setup, grip and tilt](14-camera-setup.md) | - | Sonnet | - |
| 15 | [Auto-move](15-auto-move.md) | - | Opus then Sonnet | 12 |
| 16 | [Trajectory aid](16-trajectory-aid.md) | - | Opus then Sonnet | 12 |
| 17 | [Training mode](17-training-mode.md) | - | Opus then Sonnet | 12, 14, 15, 16 |
| 18 | [Potentially later](18-later.md) | - | Opus | parked |

## Order

1. **Before crit 9 (It's alive):** 02 deploy, first draft of 01, start 10
   (CLAUDE.md is already real; write PROCESS.md from commits so far).
2. **Before crit 10 (All at once):** 05 decision written down and built, 03,
   04, 07 for each, rewrite 01 and 10.
3. **Before crit 11 (Fly by instruments):** 08, 06, finish 09, rewrite 01 and 10.
4. **Week 12:** polish, mobile pass, final rewrites, `/comp4020:preflight`.

## Gameplay rework (tasks 11-18)

Planned 2026-10-14 from a design discussion (devlog entry that day).

Build order: 11 and 12 first (both are pure `shared/`, independent), then 13
and 15 (need 11 and 12), 14 alongside, then 16, then 17 last. 18 is parked.

Using separate agents:
- **Parallel, no shared files:** 11 (new `scoring.ts`) and 12 (`sim.ts`
  `launch`/`Miss`) can run as two agents at once, each in its own
  `isolation: "worktree"`. 14 (`client/input/camera/`) is also disjoint from
  both. Three agents, no overlap.
- **Serial:** 13 touches `rooms.ts` and the protocol, and 15 and 16 both depend
  on 12, so start them only after 12 is merged. 17 waits for everything.
- **Opus first on design-heavy work** (12 tuning, 13 state machine, 15 rule,
  16 and 17 design); hand the written decisions to a Sonnet agent to build.
- **A fresh reviewer agent** (given the diff, not our conclusions) after 12 and
  13, since they change the server's rulings.
- **Merging:** per CLAUDE.md, each agent stages files by name and each branch
  is checked on a clean build; I run `pnpm check` and `pnpm e2e --workers=1`
  and only commit on green. Ask before any push.
- Every task also updates README, CLAUDE.md layout and `spec/` so the three
  agree, and adds a devlog entry.

## Rules for these files

- A task is done when its "Done when" list is true and checked, not when the
  code exists.
- Update the status line in the file when you finish or change scope.
- When a crit's spec or the brief changes a task, edit the file; don't add a
  second one.
