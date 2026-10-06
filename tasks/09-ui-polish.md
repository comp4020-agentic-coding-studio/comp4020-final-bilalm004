# 09 UI, accessibility and polish

Status: not started (menu and court view exist and fit both viewports)
Model: Sonnet

## Goal
A newly invited member can use the app for ten minutes at either viewport,
with the keyboard, and not get lost.

## Scope
- Lobby: open rooms (if task 05 says public), invite link flow, clear room
  states (waiting, in progress, finished, rematch).
- Game view: readable score and status, spectator cheer, rematch button,
  sound (off by default, toggle).
- Accessibility: focus order, visible focus, aria-live for score and status,
  reduced-motion respect, colour contrast.
- Mobile: portrait court framing, thumb-reachable controls, safe areas.
- Load: lazy-load the game view so the menu is fast (bundle is ~136 kB gzip,
  mostly Three.js).

## Done when
- [ ] Playwright covers both viewports for lobby, in-game and game-over.
- [ ] Keyboard-only walkthrough works: menu -> room -> swing -> leave.
- [ ] No horizontal scroll or clipped controls at 1920x1080 and 390x844.
- [ ] Screenshots for the README taken from the real app.
