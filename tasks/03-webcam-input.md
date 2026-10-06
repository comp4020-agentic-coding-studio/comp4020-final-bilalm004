# 03 Webcam swing input

Status: design decided, not started
Model: Opus for the design and swing heuristic, Sonnet for wiring and tests

## Goal
A player aims with their hand and swings in front of their webcam. The game
receives the same swing event the keyboard sends, extended with a shot type.
Camera is for gameplay only.

## Decisions
- **Aim (decided): point, then swing, with the racket hand.** The hand's
  lateral position relative to the shoulder centre, measured against a
  calibrated neutral, sets `dirX`. Aim is **locked when the swing starts**, so
  the wind-up can't throw it off. Smooth the pointer with a One Euro filter.
  Swing timing does not affect aim.
- **Reticle (decided):** a marker on the opponent's court shows where the ball
  would land. The client runs the shared sim forward (current ball, current
  aim, nominal power, to the first bounce). It is a guide; the server still
  decides the real hit. Only your own reticle is shown, never the opponent's.
  Keyboard arrows, mouse x and touch drive the same marker.
- **Power (decided):** peak wrist speed in shoulder-widths per second, mapped
  to 0-1, with a short soft-swing/hard-swing calibration.
- **Forehand vs backhand (decided):** from handedness plus swing direction. A
  swing crossing the body toward the off-hand side is a forehand; moving back
  out toward the racket side is a backhand. Forehand gets the full power range;
  backhand is capped (about 80%) but steadier. A swing type that doesn't match
  the ball's side is weaker. Handedness is a setting (default right).
- **Movement (proposed, confirm):** automatic like Wii Tennis, with limited
  reach, so very wide shots are out of reach for humans and the bot alike. The
  camera never moves the player.
- **Camera setup (proposed, confirm):** laptop webcam, head and shoulders
  visible, one arm swinging. Everything is measured in shoulder-widths so
  distance from the camera doesn't matter.

## Scope
- MediaPipe pose landmarks, lazy-loaded only when a player picks the camera
  (dynamic import, so the menu stays light).
- Pure functions for: aim from landmarks, swing detection (velocity threshold
  plus cooldown), power mapping, forehand/backhand classification. No DOM in
  them, so they unit-test on synthetic landmark sequences.
- Swing event gains `kind: "forehand" | "backhand"`; `shared/protocol.ts` and
  the tennis adapter validate it, the sim applies the power cap and mismatch
  penalty.
- `predictLanding(state, aim)` in `shared/games/tennis/` used by the reticle.
- Calibration screen: neutral position, soft and hard swing, handedness, and a
  visible "tracking" indicator.
- Failure paths: permission denied, no camera, or the model fails to load
  falls back to keyboard/pointer with a clear message. Never block the game.
- Privacy: video stays in the browser; only swing events are sent.

## Done when
- [ ] A swing from a real webcam returns a ball in a practice game.
- [ ] The reticle matches the real landing point closely (within about half a
      court width at nominal power) and is hidden for the opponent.
- [ ] Aim does not change between swing start and contact (unit test).
- [ ] Forehand/backhand classification, power mapping and the backhand cap are
      covered by unit tests; the sim stays deterministic.
- [ ] Denying permission leaves a playable game and a visible explanation.
- [ ] Network tab shows no video upload (verify, then say so in the README).
- [ ] Playwright with the fake webcam flag covers the camera path starting and
      the denied/fallback path at both viewports.

## Risks
- Lighting and framing vary; a mobile CPU runs detection and the 3D renderer
  together. Cap pixel ratio, lower the detection rate if needed, log real
  numbers.
- If aiming with the racket hand still feels off after locking at swing start,
  switch to using the other hand as the pointer (needs both hands in view).
