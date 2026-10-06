# 10 Process evidence

Status: ongoing (CLAUDE.md written; PROCESS.md and reflections still templates)
Model: Opus

## Goal
Process legibility is 50% of the mark. Markers follow the links you give them,
so the account must point at real commits.

## Scope
- `PROCESS.md`, 900-1100 words, **rewritten** (not appended) at each crit:
  stack and agent workflow, trade-offs (why not Astro, why `node:sqlite`, why a
  server-owned sim), what you'd do differently. Link commits by hash.
- `CLAUDE.md`: when the agent gets something wrong, the fix lands here or in
  `spec/`, with a commit that shows it. Keep it short.
- Three crit reflections in `reflections/` (see its README).
- Optional ADRs for the big choices (stack, netcode model, multi-user rules).
- Small commits with clear messages, so ranges make good evidence links.

## Done when (per crit)
- [ ] `pnpm check:evidence` passes (template comment gone, linked commits exist).
- [ ] At least one linked example of a correction absorbed into the harness.
- [ ] README, CLAUDE.md and spec still agree (task 07's table).
- [ ] Reflection for that crit written and committed.

## Habit
When you correct the agent in chat, ask: should this be a rule or a test? If
yes, make that commit now and note its hash for PROCESS.md.
