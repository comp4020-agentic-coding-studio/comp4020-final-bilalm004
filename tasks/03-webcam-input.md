# 03 Webcam swing input

Status: not started
Model: Opus for the design and swing heuristic, Sonnet for wiring and tests

## Goal
A player swings in front of their webcam and the game receives the same
`{dirX, power}` event the keyboard sends. Camera is for gameplay only.

## Scope
- MediaPipe (pose or hands), lazy-loaded only when a player enters a game and
  picks the camera. Dynamic import so the menu stays light.
- Swing detection: wrist velocity over a threshold, cooldown, direction to
  `dirX`, speed to `power`. Mirror correctly for seat 1 (view is flipped).
- Calibration/ready step and a visible "tracking" indicator.
- Permission denied, no camera, or model fails to load: fall back to
  keyboard/pointer with a clear message. Never block the game.
- Privacy: video stays in the browser; only swing events are sent.

## Done when
- [ ] Swing from a real webcam returns a ball in a practice game.
- [ ] Denying permission leaves a playable game and a visible explanation.
- [ ] Network tab shows no video upload (verify and say so in README).
- [ ] Playwright runs with the fake webcam flag and covers the camera path
      starting, plus the denied/fallback path, at both viewports.
- [ ] Detection logic is a pure function with unit tests on recorded or
      synthetic landmark sequences.

## Risks
Lighting and framing vary; mobile CPU with the 3D renderer running. Cap pixel
ratio, run detection at a lower frame rate if needed, log the real numbers.
