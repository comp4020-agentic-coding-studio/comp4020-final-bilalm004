# 03 Webcam swing input

Status: design decided, not started
Model: Opus for the design and swing heuristic, Sonnet for wiring and tests

## Goal
A player moves, aims and swings in front of their webcam. The game receives
the same events the keyboard sends. Camera is for gameplay only.

## Decisions
- **Camera setup:** laptop webcam, head and shoulders visible, one arm
  swinging. Everything is measured in shoulder-widths, so distance from the
  camera doesn't matter.
- **Movement:** shoulder tilt (roll of the shoulder line). Subtle: a dead zone
  plus a high gain so about 8-10 degrees of tilt covers the court, calibrated
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
- **Forehand vs backhand:** handedness (setting, default right) plus swing
  direction. Crossing the body toward the off-hand side is a forehand; moving
  back out toward the racket side is a backhand. Forehand gets all three
  levels at full strength; backhand hard is capped slightly below forehand
  hard but steadier. A swing type that doesn't match the ball's side is weaker.

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
- [ ] The reticle matches the real landing point closely (within about half a
      court width) and is hidden for the opponent.
- [ ] Aim and movement target don't change between swing start and contact
      (unit tests).
- [ ] Level thresholds, hysteresis, forehand/backhand classification and the
      backhand cap are unit-tested; the sim stays deterministic and the old
      power-based sim tests are updated to levels.
- [ ] Reach and speed cap: a wide shot is unreachable for humans and the bot
      alike (spec test).
- [ ] Denying permission leaves a playable game and a visible explanation.
- [ ] Network tab shows no video upload (verify, then say so in the README).
- [ ] Playwright with the fake webcam flag covers the camera path starting and
      the denied/fallback path at both viewports; touch buttons are reachable
      at 390x844.

## Risks
- Lighting and framing vary; a mobile CPU runs detection and the 3D renderer
  together. Cap pixel ratio, lower the detection rate if needed, log real
  numbers.
- Tilt and arm movement are coupled; if frozen tilt plus the shoulder-aligned
  aim still feel off, widen the dead zone or switch aim to the other hand
  (needs both hands in view).
- Player-controlled movement raises the bar for keyboard and touch users;
  watch that the fallback isn't a worse game.
