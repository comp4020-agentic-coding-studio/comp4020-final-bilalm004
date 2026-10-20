# 15 Webcam by default

Status: queued. Narrowed 2026-10-21: the dedicated sport pages and recorded
thumbnails are dropped for now (user); they can return later.
Model: Sonnet
Session: B (first)
Waits on: nothing now (tasks 4 and 5 are built)

## Goal
Starting a game opens the camera flow first. The camera is the default way to
play and is still never required.

## Scope
- When a game starts (practice, room, training), the camera setup opens first:
  safety notice, then start camera, with a clear "Use keyboard instead" path.
- Training becomes the step after the camera setup, as the handoff notes
  ("Train is not yet the default way in after the camera notice"). Keep Train
  also available as its own button, and keep Skip training.
- Denying permission, or no camera present, falls back to the keyboard without
  a dead end.
- Every camera action keeps its keyboard or mouse equivalent; the lobby and room
  work with no camera at all (CLAUDE.md rule).
- The saved movement/swing mode choices still apply; training still starts in
  auto-move whatever was saved.

## Done when
- [ ] Starting a game opens the camera flow first; "keyboard instead" and a
      denied permission both reach a playable game. e2e covers both, at both
      viewports.
- [ ] Training follows camera setup, and Skip works.
- [ ] CSP unchanged; video still never leaves the browser.
- [ ] README and CLAUDE.md say webcam is the default and still optional.
