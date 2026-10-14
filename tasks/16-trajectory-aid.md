# 16 Trajectory aid

Status: planned
Model: Opus for the design, Sonnet for the rendering

Depends on: 12 (height-compensated `launch()`)

## Goal
Players can see where timing sends the ball and learn the early/on-time/late
mapping. Replaces the old point-aim reticle for timing mode.

## Design
- **Three arcs: early, on time, late.** As the ball crosses the hitting window,
  the arc for the current moment lights up and the other two are greyed. The
  lit arc follows the grip: forehand and backhand mirror early/late.
- **Timing meter** along the bottom: early | on time | late, with a marker
  moving across as the ball arrives. The meter says when; the arcs say where.
- **Strength:** unknown until the swing ends, so the lit arc carries three depth
  ticks (light, medium, hard). The tick matching the last swing is highlighted,
  and during a swing it slides with the peak speed so far (a guide only).
- **After the hit:** the real arc, from the same `launch()` the server used,
  replaces the three arcs, and the detected strength is shown.
- Toggleable; keyboard and mouse show the chosen strength directly.
- Built on `predictLanding` and `shot-fx.ts`. A prediction only: the server
  rewinds to the swing time (ADR 001) and decides.

## Done when
- [ ] Test: predicted arcs land on the same side as `timingAim` for every hand,
      kind and timing.
- [ ] Greying/lighting follows the ball in an e2e at both viewports.
- [ ] Off switch works; nothing else depends on it.
