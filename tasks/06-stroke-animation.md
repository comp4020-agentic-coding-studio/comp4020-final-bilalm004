# 6 Forehand and backhand look different

Status: not started (left over from the camera setup work, now in `done/`)
Model: Sonnet

## Goal
A player can see which shot they played. The backhand currently doesn't read
clearly on screen.

## Scope
- Read `client/games/tennis/character.ts` first: is the backhand animation
  distinct from the forehand, or only the racket side that changes?
- Give each its own arc (mirrored racket path, different body turn).
- A brief "FOREHAND" / "BACKHAND" label on the shot, in the HUD, kept clear of
  the score bar and the camera dock.
- The wrong-side miss ("wrong side") should look like what it is, so a player
  understands why the swing missed.

## Done when
- [ ] The two strokes look different at 1920x1080 and 390x844 (e2e screenshot
      check or a measured pose difference, not only by eye).
- [ ] The label shows for both seats and never covers the court or camera dock.
- [ ] Respects reduced motion (label stays, flourish doesn't).
