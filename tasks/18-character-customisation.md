# 18 Character customisation

Status: queued
Model: Sonnet
Session: A, after 17 (needs accounts)

## Goal
A signed-in player picks how their character looks; everyone in the room sees
it.

## Decided (user, 2026-10-21)
Colours for shirt, shorts, skin and hair, plus a hat or hairstyle, all from a
fixed list. Good enough for now.

## Scope
- A fixed enum palette and list in `shared/` (so server and client share it).
  The look is stored on the profile as small enum values, validated on the
  server; anything outside the lists is rejected, never stored.
- The server puts each seat's look in the room state; `character.ts` renders it
  (colours as material parameters, hats and hair as a few primitives, flat
  shaded, no assets). Spectators see it too.
- A customise panel on the profile with a live preview; works at both viewports
  and by keyboard.
- Guests get a default look and cannot save one.
- The look is deleted with the account (task 17).

## Done when
- [ ] Server rejects an out-of-list value (hostile client test).
- [ ] Look saved, survives a restart, shows on both seats and to a spectator.
- [ ] Both viewports checked; preview not clipped.
- [ ] CLAUDE.md layout and `spec/` updated.
