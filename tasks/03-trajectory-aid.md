# 3 Trajectory aid

Status: done (devlog 2026-10-15 01:19); playtest the colours and the meter with a real camera
Model: Opus for the design, Sonnet for the rendering

Depends on: shot rules (done; height-compensated `launch()`)

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

## Built
- `client/games/tennis/trajectory-aid.ts` (pure, `spec/trajectory-aid.test.ts`):
  `windowPosition` (the same -1..1 measure `timingAim` uses), `litTiming`
  (thirds of the window), `meterPosition`, `timingArcs` (each arc is a copy
  of the sim stepped to that moment and hit with a timing-aimed swing, so it
  is what the server does), `realArc`, `strengthPosition`/`shownStrength`.
  No change to `sim.ts`.
- `aid-fx.ts` draws the arcs, depth ticks and slider, and the real arc;
  `aid.ts` the meter, strength readout and "Aid" toggle (in `aid.css`, along
  the bottom above the stroke label, hidden while the camera panel is open).
- The three arcs show with the camera on and aiming by timing; they replace
  the reticle and single arc then. With keys/mouse the reticle and arc stay,
  the depth ticks sit on the aimed shot, and the chosen strength is picked.
- Arcs are computed once per incoming shot (grip, strength); a passed arc
  keeps showing where it would have gone.
- Camera peak speed: `SwingDetector.peak` and `CameraOutput.peak` (classic
  mode only; follow mode has no swing in progress).
- Off switch remembered in localStorage (`trajectory-aid`), default on.

## Done when
- [x] Test: predicted arcs land on the same side as `timingAim` for every hand,
      kind and timing.
- [x] Greying/lighting follows the ball in an e2e at both viewports.
- [x] Off switch works; nothing else depends on it.
