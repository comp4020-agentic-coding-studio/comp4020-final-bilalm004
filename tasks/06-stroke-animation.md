# 6 Forehand and backhand look different

Status: done (2026-10-15; devlog 01:25). Strokes keyframed in
`client/games/tennis/stroke.ts`, label `.shot-label` in the view.
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

## Findings
- The old backhand had its own branch, but it was the forehand's sweep run
  backwards: same arm height (1.35), same racket face (roll +PI/2, so the
  backhand showed the forehand face), straight elbow, off arm still, and a
  body turn that just mirrored the forehand's. Swept 0.25 m apart at most
  mid-swing.
- The opponent's and bot's strokes were picked up at 45% of a 320 ms swing,
  which is where both arcs point the arm straight ahead, so a viewer saw
  almost the same follow-through for either.

## What changed
- `stroke.ts`: each stroke is three keyframes (wind-up, contact at 0.45,
  finish) of arm, elbow, wrist, racket face, shoulder turn and off arm. The
  forehand goes back low on the racket side with the shoulders coiled away and
  finishes high over the other shoulder; the backhand goes back across to the
  far hip with the face turned over and the off arm on the racket, and
  finishes out on the racket side with the off arm flung back. Swing lasts
  420 ms. Body turn now mirrors for a left-hander too (it didn't before).
- `character.ts` `racketHead()` reports the racket position so the arcs can be
  measured.
- `.shot-label`: FOREHAND (yellow) or BACKHAND (blue) for 1.1 s on every
  stroke, both seats, keyboard, button, camera and bot alike; the opponent's
  says their name. Desktop: in the left stands, half way down (the camera dock
  is on the right, the score bar and timing meter top and bottom). Phone:
  bottom left, above the existing stroke line. Pop-in only without
  reduced motion.
- Wrong side: the label goes red, the stroke is struck through, and it says
  "Wrong side: ball was on your backhand" (or forehand), with a shake when
  motion is allowed. It shows from the screen's own prediction at once, and
  again if the server's ruling says wrong side when the screen didn't predict it.

## Done when
- [x] The two strokes look different at 1920x1080 and 390x844 (e2e screenshot
      check or a measured pose difference, not only by eye).
      `spec/stroke.test.ts` measures the racket head on the rig (wind-up,
      contact and finish on opposite sides, opposite shoulder turns, mirrored
      for a left-hander); `e2e/stroke.e2e.ts` projects both arcs through the
      game camera at both viewports and checks the contact points are at least
      half the contact height apart on screen.
- [x] The label shows for both seats and never covers the court or camera dock.
      e2e checks seat 0, the bot's shots and seat 1 by invite, against the
      court's projected corners, the controls, the stroke line and `.cam-dock`.
- [x] Respects reduced motion (label stays, flourish doesn't). e2e checks
      `animation-name` is `none` under `reducedMotion: "reduce"`.

## Open
- Wrong side is told apart in the label only; the character still plays the
  stroke it was asked for. A visible "air shot" (racket passing the ball) would
  make it clearer still.
- The label positions assume the score bar (task 1) stays at the top and the
  timing meter (task 3) at the bottom; re-run `e2e/stroke.e2e.ts` after the merge.
