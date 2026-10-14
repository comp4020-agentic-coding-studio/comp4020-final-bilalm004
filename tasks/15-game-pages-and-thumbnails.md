# 15 Dedicated game pages, recorded thumbnails, webcam by default

Status: queued
Model: Opus
Waits on: task 4 (room rules, ready-up) for the ready flow, task 5 (training
mode) for the page's Train button; the thumbnail recording can start earlier

## Goal
Selecting a sport opens its own page. The tennis thumbnail is a real recorded
rally. Starting a game defaults to the webcam.

## Scope
- **Dedicated page per sport:** selecting a sport on the home screen opens that
  sport's page (route such as `#/tennis`) with its name, the thumbnail, a short
  how-to, and its actions (play, create a room, join by code, and training once
  task 5 lands). The page is driven by the same `SPORTS` list, so a new sport
  gets a page from one entry. Back returns home; the browser back button works.
- **Recorded thumbnail:** a short rally between two bots, recorded and used as
  the thumbnail on the home screen and the sport's page. Record it from the real
  sim and renderer, not a mock: the sim is deterministic, so store the seed and
  the input stream and replay it (a few KB) rather than shipping video, unless
  that looks wrong; if a video or animated image is needed, keep it small and
  built into the repo with no third-party assets. Loops, muted, no sound,
  paused under prefers-reduced-motion (a still frame instead).
- **Webcam is the default:** when a game starts, the camera setup opens first
  (safety notice, then start camera) instead of keyboard first, with a clear
  "Use keyboard instead" path. Camera is still never required: every camera
  action keeps its keyboard or mouse equivalent, the lobby and room work with
  no camera, and denying permission falls back to the keyboard.

## Done when
- [ ] Route per sport, back works, both viewports, no horizontal scroll.
- [ ] Thumbnail plays from a recorded seed and input stream; reduced motion
      shows a still.
- [ ] Starting a game opens the camera flow first; "keyboard instead" and a
      denied permission both reach a playable game. e2e covers both.
- [ ] README and CLAUDE.md say webcam is the default and still optional.
