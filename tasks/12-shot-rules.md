# 12 Shot rules: strength, height, timing, wrong side

Status: planned
Model: Opus for the design and tuning, Sonnet for the tests

## Goal
Each control does one thing, in the style of Wii Tennis. Classic swing and
timing aim are the camera's only modes.

- **Timing** sets left-right (early: cross-court, on time: straight, late: down
  the line). Forehand or backhand mirrors it. `timingAim` already does this.
- **Strength** (light / medium / hard) sets depth and pace.
- **Height is never a control.** `launch()` solves the vertical speed so the
  ball lands at the depth strength asks for, whatever the contact height, and
  always clears the net.
- **Wrong side is a miss** (`"wrong side"` added to `Miss`). The `MISMATCH`
  penalty is deleted.

## Notes from the investigation
- Today `STROKES` loft plus `heightGain` makes depth depend on contact height
  (checked with `predictLanding`: at ideal height all levels land about 6 m
  deep; at 0.5 m hard goes into the net, at 1.5 m it goes long). Aim spread is
  independent of level.
- Measure real contact heights in a simulated rally before tuning; the 0.5/1.0/1.5
  values above were set by hand.
- Target depths are a guess (light about 4 m, medium 6, hard 8 past the net);
  tune by playtest and check rallies don't collapse to everyone hitting hard.
- Mismatched side used to be 0.8x speed and 1.15x loft. Becoming a miss makes a
  wrong camera grip costly, so task 14 must make the grip reliable first or
  auto-pick the kind from the ball's side.

## Done when
- [ ] Table test: contact heights 0.5-1.5 m, every level, both kinds: lands in
      bounds and clears the net (fails on current code).
- [ ] Test: a swing of the wrong kind returns `"wrong side"`.
- [ ] `predictLanding` uses the same `launch()`; bot unchanged in behaviour.
- [ ] Detected level shown after each swing (HUD).
- [ ] Three levels vs two decided and written here.
- [ ] `pnpm check` green.
