# 12 Shot rules: strength, height, timing, wrong side

Status: done (HUD level display shipped with task 3, the trajectory aid)
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

## Decisions (first pass, see devlog 2026-10-14 23:17)
- Measured bot-vs-bot contact heights (200 seeds x 2 min): medium returns are
  met at 0.84-1.11 m (median 0.91), serve returns at 1.04-1.11 m. Everyone
  hitting light meets the ball at 1.1-1.46 m; everyone hitting hard at
  0.38-1.11 m (median 0.45). So 0.5-1.5 m covers real play.
- `STROKES` is now `{ speed, depth }`: light 11 m/s to 4 m past the net,
  medium 14 m/s to 6 m, hard 18 m/s (backhand 16.5) to 8 m. `launch()` takes
  the flight time from the speed and solves the upward speed for the tick
  integration, so the first bounce is within a tick's travel of the depth
  (measured 0.02-0.3 m) from 0.1 to 2.6 m contact anywhere in the window. If
  the arc would cross the net below `NET_CLEARANCE` (net + 0.3 m) it is
  slowed and lofted just enough.
- Follow-mode `lift` now adds up to +-1 m of depth (clamped 2.5 m to 9.5 m)
  instead of upward speed.
- **Three levels kept.** Hard pays with a wider aim spread (`AIM_SPREAD`
  0.15 / 0.2 / 0.26): over the whole timing window, timing-aimed shots go out
  8% light, 15% medium, 29% hard; hard reaches the far baseline in 1.2 s vs
  1.56 s medium and 1.98 s light. Full aim stays in at light/medium and goes
  wide at hard.
- Wrong side: `missReason(s, seat, kind, hand)` returns `"wrong side"`; a ball
  within `EITHER_SIDE` (0.3 m) of the player's middle can be taken either way.
  `predictLanding` with a held grip that doesn't fit shows `in: false`.

## Done when
- [x] Table test: contact heights 0.5-1.5 m, every level, both kinds: lands in
      bounds and clears the net (fails on current code).
- [x] Test: a swing of the wrong kind returns `"wrong side"`.
- [x] `predictLanding` uses the same `launch()`; bot unchanged in behaviour
      (bot-vs-bot mean rally 3.77 shots before, 3.9 after).
- [x] Detected level shown after each swing (HUD): "Detected: hard" for a
      camera swing, "Chosen: hard" for keys and buttons, next to the timing
      meter (`client/games/tennis/aid.ts`, e2e in `e2e/aid.e2e.ts`).
- [x] Three levels vs two decided and written here.
- [x] `pnpm check` green.
