# 16 Point-scored banner and reaction effects

Status: queued
Model: Opus
Waits on: nothing in the sim; touches the score bar (task 1) and the stage
(character.ts), so do it as one change

## Goal
When a point is scored the call appears across the top in bold, in tennis terms
("15-Love", "30-15", "Deuce", "Advantage", "Game"), without covering the court;
the players react.

## Scope
- **Top banner:** a bold call across the top of the game screen, clear of the
  court, the score bar, the camera dock and the timing meter, at 1920x1080 and
  390x844. It uses tennis wording: love for zero, "all" for ties ("30-all"),
  Deuce, Advantage <name>, Game, Set, Match. The score bar's existing
  announcement (task 1) is folded into it, not duplicated.
- **Reaction effects:** the player who loses the point gets a frustrated
  scribble over their head; the winner gets a fitting effect (for example
  sparkles or a fist pump, stronger for a game or set). Effects are drawn over
  the characters on the client from the server's score snapshot.
- **Local to each screen (the user's suggestion, and the right call):** effects
  are purely visual and driven by the snapshot each client already receives, so
  nothing is sent over the network and the server stays the only owner of the
  score. Each player sees them on their own screen; spectators see them too.
- Respects prefers-reduced-motion (a static mark instead of a scribble
  animation); the call is also in a live region for screen readers.

## Done when
- [ ] Banner never overlaps the court or other HUD pieces at both viewports.
- [ ] Wording test: every score transition produces the right call (table).
- [ ] Effects show for loser and winner, both seats, bot points and spectators.
- [ ] No new network messages (spec on allowed messages still passes).
