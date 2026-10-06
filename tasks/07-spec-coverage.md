# 07 Spec coverage

Status: ongoing (sim, rooms and README checks exist)
Model: Sonnet

## Goal
Every claim in the README and every rule in CLAUDE.md has a check, so the
three documents agree and the mark for "checks" is earned, not asserted.

## Scope
- Keep a short table (in this file) of README claim -> test name.
- Add tests per feature as it lands (see "Done when" in tasks 03-06).
- Never delete `spec/invariants.test.ts`.
- Bug rule: every fix adds a test that fails without it.
- e2e at both viewports for every new screen.

## Done when (per crit)
- [ ] `pnpm check` and `pnpm e2e` green before every commit.
- [ ] README claims table has no unmatched rows.
- [ ] CI `check` job green on the crit cutoff commit.

## Claims table
| README claim | Test |
|---|---|
| Server decides hits, clients can't move the ball | `spec/rooms.test.ts` ignores a swing during the serve |
| Same seed and inputs give the same match | `spec/sim.test.ts` deterministic |
| Works at 1920x1080 and 390x844 | `e2e/layout.e2e.ts` |
