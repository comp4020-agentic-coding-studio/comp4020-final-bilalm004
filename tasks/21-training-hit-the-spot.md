# 21 Training: endless hit-the-spot

Status: queued
Model: Sonnet (well specified; Opus only if the scoring feels wrong)
Session: C, after 20 or alongside it (different files)

## Goal
An unlimited practice mode inside training: balls keep coming and you try to
land your returns on a marked spot.

## Scope
- A new mode in `client/training*.ts` beside the required lesson steps; it does
  not replace them and is not required. Offered from the training screen.
- Runs entirely in the page like the rest of training: no room, no score sent,
  no rating, nothing to the server (`spec/training.test.ts` must still pass, and
  the "nothing sent" assertion extends to this mode).
- The ball machine keeps feeding from its seeded stream; a target spot is drawn
  on the opponent's half and moves after a hit or every few balls. Show how
  close each return landed (distance in a word or a ring colour), a streak, and
  a best streak kept locally.
- Unlimited: no end state, an Exit button, keyboard and camera both work; the
  camera stays optional.
- Deterministic (seed + inputs) so it can be tested; target placement comes from
  a seeded stream in a pure module.

## Done when
- [ ] Pure module test: target placement and the closeness scoring for a table
      of landings.
- [ ] e2e at both viewports: enter the mode, hit, see the result, exit; assert
      no websocket frames are sent.
- [ ] CLAUDE.md training rule and README updated.
