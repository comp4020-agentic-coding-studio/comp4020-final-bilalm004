# 03 Webcam swing input

Status: steps 1 and 2 done (sim, protocol, fallback input, camera layer, calibration, reticle); needs a real-webcam playtest, and the README privacy line waits on task 01
Model: Opus for the design and swing heuristic, Sonnet for wiring and tests

## Goal
A player moves, aims and swings in front of their webcam. The game receives
the same events the keyboard sends. Camera is for gameplay only.

## Decisions
- **Camera setup:** laptop webcam, head and shoulders visible, one arm
  swinging. Everything is measured in shoulder-widths, so distance from the
  camera doesn't matter.
- **Movement:** shoulder tilt (roll of the shoulder line). A 3 degree dead zone
  so a natural sway doesn't move you, and about 16 degrees of tilt covers the
  court (first playtest: 9 degrees was too quick), calibrated
  against a neutral. Movement is player-controlled and server-authoritative:
  the client sends a target position about 20-30 times a second, the server
  moves the player toward it at a capped speed, and a hit needs the ball within
  reach. The bot follows the same rule. Tilt is frozen from swing start to
  contact.
- **Aim:** point, then swing, with the racket hand. The hand's lateral position
  in the shoulder-aligned frame (so tilt doesn't leak into aim) relative to a
  calibrated neutral sets `dirX`. Locked when the swing starts. One Euro
  filter on the pointer. Swing timing does not affect aim.
- **Reticle:** a marker on the opponent's court shows where the ball would
  land, found by running the shared sim forward (current ball, current aim,
  current level, to the first bounce). A guide only; the server decides the
  real hit. Only your own reticle is shown. Keyboard arrows, mouse x and touch
  drive the same marker.
- **Swing strength: three levels, light / medium / hard.** Peak wrist speed
  (shoulder-widths per second) against two calibrated thresholds with
  hysteresis. Each level sets launch speed and loft. Contact height matters: a
  low ball hit hard risks the net, a high ball hit hard risks going long, so
  hard is riskier. The swing event sends `level` (0, 1, 2) instead of `power`.
- **Forehand vs backhand: the grip, not the swing direction** (changed after
  the first playtest). Palm toward the camera is a forehand grip, the back of
  the hand a backhand, read from the forearm (elbow to wrist) against the
  pinky-to-thumb line in the body frame, so it holds arm up or down, mirrored
  or not. An unclear reading keeps the last grip. The swing uses the grip
  held when it started. In a backhand stance, aim is measured from the
  calibrated neutral reflected across the body, and the reticle shows the
  backhand (mismatch penalty included). Forehand gets all three levels at full
  strength; backhand hard is capped slightly below forehand hard but steadier.
  A swing type that doesn't match the ball's side is weaker.

## Fallback input (must stay fully playable with no camera)
- Keyboard: A/D move, arrows aim, Space medium, keys 1/2/3 light/medium/hard.
- Touch: left/right move buttons, tap or drag the court to aim, three swing
  buttons (light, medium, hard).
- Camera denied, missing, or model fails to load: fall back with a clear
  message. Never block the game.

## Scope
- MediaPipe pose landmarks, lazy-loaded only when a player picks the camera
  (dynamic import, so the menu stays light).
- Pure functions, no DOM, unit-tested on synthetic landmark sequences: tilt to
  movement target, aim from landmarks, swing detection (velocity threshold,
  cooldown), level from speed, forehand/backhand classification.
- Sim changes in `shared/games/tennis/`: player position and speed cap, reach
  check on hits, level to launch speed and loft, contact-height effect,
  backhand cap and mismatch penalty, `predictLanding`.
- Protocol: swing gets `kind` and `level`; a move message carries the target
  position. Server validates and rate-limits both.
- Calibration screen: neutral tilt and hand position, soft/medium/hard swing,
  handedness, and a visible "tracking" indicator.
- Privacy: video stays in the browser; only movement targets and swing events
  are sent.

## Done when
- [ ] A swing from a real webcam returns a ball in a practice game, and tilting
      moves the player.
- [x] The reticle matches the real landing point closely (within about half a
      court width) and is hidden for the opponent. (Exact for a hit at the
      baseline, spec test; only drawn for your own seat.)
- [x] Aim and movement target don't change between swing start and contact
      (unit tests).
- [x] Level thresholds, hysteresis, forehand/backhand classification and the
      backhand cap are unit-tested; the sim stays deterministic and the old
      power-based sim tests are updated to levels.
- [x] Reach and speed cap: a wide shot is unreachable for humans and the bot
      alike (spec test).
- [x] Denying permission leaves a playable game and a visible explanation.
- [ ] Network tab shows no video upload (verify, then say so in the README).
      Verified: e2e checks every completed request is a GET to this server or
      the model hosts, and every game message is small and of a known type.
      MediaPipe POSTs usage stats to odml.pa.googleapis.com; the CSP blocks
      it. README line still to write (README is still the template, task 01).
- [x] Playwright with the fake webcam flag covers the camera path starting and
      the denied/fallback path at both viewports; touch buttons are reachable
      at 390x844.

## Step 1 notes
- Stroke table in `shared/games/tennis/sim.ts` (speed, loft, height gain per
  level and kind). Tuned so light is safe at any height and hard only works
  from about 0.9 to 1.5 m; bot-vs-bot contacts land around 0.85-1.1 m.
- Keyboard/touch move = target at the sideline while held, then the last
  server position on release, so it overshoots by about one round trip of
  movement. Revisit in task 04 if it feels sticky.
- `predictLanding` assumes contact at your baseline with the swing that suits
  the ball's side; it matches a real hit there exactly (spec test).

## Step 2 notes
- MediaPipe 1.0.1 pose lite, runtime from jsdelivr, model from Google
  storage, loaded by dynamic import (separate chunk) on "Start camera".
  Detection 30 Hz on desktop, 15 Hz on coarse-pointer devices; the tracking
  chip shows the live fps.
- Default thresholds (shoulder-widths/s): start 2.5, light/medium 5,
  medium/hard 9, hysteresis 10%. Calibration replaces the two level
  thresholds with midpoints between your own swings' medians.
- The freeze uses values from 100 ms before the detected swing start, because
  the wind-up moves the hand before it counts as a swing (unit test).
- Playtest: only forehands showed. Taking the racket back before a backhand
  moves the wrist the forehand way and was detected as a forehand first. A
  camera swing is now only sent when the ball reaches you within 0.3 s
  (`swingTiming`); earlier ones show "too early, not sent". The racket and a
  stroke label now show forehand vs backhand.
- Then grip replaced direction for forehand/backhand (see Decisions); the
  0.3 s gate stays so an early swing doesn't use up the server's cooldown.
- Not yet tried with a real person on camera: thresholds, tilt gain and aim
  range are guesses until then.

## Risks
- Lighting and framing vary; a mobile CPU runs detection and the 3D renderer
  together. Cap pixel ratio, lower the detection rate if needed, log real
  numbers.
- Tilt and arm movement are coupled; if frozen tilt plus the shoulder-aligned
  aim still feel off, widen the dead zone or switch aim to the other hand
  (needs both hands in view).
- Player-controlled movement raises the bar for keyboard and touch users;
  watch that the fallback isn't a worse game.
