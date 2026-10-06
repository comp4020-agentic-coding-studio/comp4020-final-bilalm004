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
| 04 | [Netcode feel](04-netcode-feel.md) | 10 | Opus | - |
| 05 | [Multi-user rules and reconnect](05-multiuser-rules.md) | 10 | Opus then Sonnet | 01 |
| 06 | [Persistence and leaderboard](06-persistence-leaderboard.md) | 10-11 | Sonnet | 05 |
| 07 | [Spec coverage](07-spec-coverage.md) | every crit | Sonnet | alongside 03-06 |
| 08 | [Server logging and stats](08-observability.md) | 11 | Sonnet | - |
| 09 | [UI, accessibility and polish](09-ui-polish.md) | 11-12 | Sonnet | 03, 05 |
| 10 | [Process evidence](10-process-evidence.md) | every crit | Opus | ongoing |

## Order

1. **Before crit 9 (It's alive):** 02 deploy, first draft of 01, start 10
   (CLAUDE.md is already real; write PROCESS.md from commits so far).
2. **Before crit 10 (All at once):** 05 decision written down and built, 03,
   04, 07 for each, rewrite 01 and 10.
3. **Before crit 11 (Fly by instruments):** 08, 06, finish 09, rewrite 01 and 10.
4. **Week 12:** polish, mobile pass, final rewrites, `/comp4020:preflight`.

## Rules for these files

- A task is done when its "Done when" list is true and checked, not when the
  code exists.
- Update the status line in the file when you finish or change scope.
- When a crit's spec or the brief changes a task, edit the file; don't add a
  second one.
