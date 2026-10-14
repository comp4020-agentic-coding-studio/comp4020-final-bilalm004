# 17 Training mode (camera onboarding)

Status: planned
Model: Opus for the lesson design, Sonnet for the build

Depends on: 12, 14, 15, 16

## Goal
The camera's default way in. After the safety notice and hand choice, the
player practises swings (and movement) against a ball machine, learns forehand,
backhand, timing and strength, then goes to the lobby. This replaces the old
"learn how to play" page.

## Decisions
- Local and solo: the same deterministic sim run in the browser, no score, no
  rating, no server room. Video still never leaves the browser.
- Auto-move on by default, so the first lesson is only swinging; tilt movement
  is a later step.
- After each swing: "early, cross-court, medium, landed here", with the landing
  spot marked on the court (task 16's arcs and meter are on).
- Guided steps, each completing when you do it: movement, forehand, backhand,
  timing to landing position, strength, camera check. Optional target zones.
- Also reachable from the lobby, and playable with keyboard and mouse.

## Done when
- [ ] Lesson steps complete from real input (and from keys, in e2e).
- [ ] No network traffic from training beyond loading the page (spec).
- [ ] Both viewports; camera notice shown.
- [ ] README and CLAUDE.md layout updated.
