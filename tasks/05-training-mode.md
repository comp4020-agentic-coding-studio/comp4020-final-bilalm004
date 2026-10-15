# 5 Training mode (camera onboarding)

Status: built (devlog 2026-10-15); wording, step order and drill details are the agent's, open to playtest
Model: Opus for the lesson design, Sonnet for the build

Depends on: 2, 3 (shot rules and camera setup are done)

## Goal
The camera's default way in. After the safety notice and hand choice, the
player practises swings against a ball machine, learns forehand, backhand,
timing to landing position and strength, then goes to the lobby. This
replaces the old "learn how to play" page.

## Decisions
- Local and solo: the same deterministic sim run in the browser, no score, no
  rating, no server room. Video still never leaves the browser.
- Auto-move on throughout the required steps (user). Moving yourself is
  optional: after the required steps, "Auto-move is on. Want to practise
  moving yourself?" Yes / No thanks (user). Training is complete without it.
- The movement drill starts you near a sideline (4.2 m out) and feeds the far
  side, crossing 2.4-3.2 m out on the other side at medium pace: standing still
  always misses, running reaches it, and auto-move's slower walk misses some
  (docs/reaction-time.md: from the middle auto reaches every in-bounds ball).
- After each swing: "Early, cross-court to the left, medium, landed in", and a
  ring where it landed (task 3's arcs and meter are on).
- Timing step: land one early, one on time and one late (user: teach when you
  swing -> where it lands).
- Short "Why?" notes, closed by default, on timing, strength and movement
  (user): placing the ball makes the opponent run; flight times 2.0 / 1.6 /
  1.2 s from docs/reaction-time.md; the point is leaving them out of position
  and out of time.
- Also reachable from the home screen ("Train"), playable with keyboard and
  mouse, and skippable at every step ("Skip step", "Skip training").

## How it works (as built)
- `view.ts` takes a `GameLink` (`on`, `send`) instead of a `Connection`, plus
  options (no room code, invite or score; leave button text; the scene).
  `LocalLink` answers the same messages from `TrainingSim` at 60 Hz: state
  every other tick, swing rulings, presence ("Ball machine"). No lobby
  messages, so the room's ready panel never shows.
- `shared/games/tennis/machine.ts`: seeded feeds per drill (forehand, backhand,
  timing, movement, mixed), launched with the sim's own `launch()`.
- Steps: camera check (any swing), forehand x2, backhand x2, timing (early,
  on time, late each in), strength (a light and a hard in); then the movement
  offer; optional targets (three circles).

## Done when
- [x] Lesson steps complete from real input (`spec/training.test.ts`) and from
      keys, in e2e (`e2e/training.e2e.ts`, both viewports).
- [x] No network traffic from training beyond loading the page (spec: no
      WebSocket or fetch; e2e: no frames but the page's own pong, no requests).
- [x] Both viewports; camera notice shown (e2e with the fake webcam).
- [x] README and CLAUDE.md layout updated.
- [ ] Real-webcam playtest of the lessons.
