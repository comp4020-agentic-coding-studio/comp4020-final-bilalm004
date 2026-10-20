# 23 Home screen polish: pointer and looping thumbnails

Status: queued
Model: Opus (visual judgment; look at it at both viewports)
Session: C, after 14 (same files: `client/ui/menu.ts`, `client/style.css`)

## Goal
The front screen feels alive: an animated logo (task 14), the arrow pointer
following the mouse, and each sport's thumbnail a short looping snippet.

## Decided (user, 2026-10-21)
- The pointer is the chunky arrow already on the selected sport's button
  (`POINTER` in `menu.ts`).
- Thumbnails are a **lighter loop animation**, not a replay of the real game.
- The logo is nicer and animated (the animation spec is task 14's).

## Scope
- **Pointer:** use that arrow, drawn in our own SVG, as the mouse cursor on the
  home screen, so it shows as the mouse moves. The marker on the hovered or
  focused sport pill stays. Mouse only: touch devices and the camera view show
  no custom cursor, and the in-game cursor is left alone. If the arrow must
  follow with a lag or glow, draw it as an element; otherwise a CSS `cursor`
  with a data-URI SVG is enough and cheaper. Interpretation to confirm with the
  user: the page cursor itself becomes this arrow.
- **Thumbnail loops:** each sport's thumbnail (`tennisThumb()` and the others)
  becomes a short seamless loop in inline SVG/CSS, for example the two figures
  trading a rally with the ball arcing between them, built from the existing
  decorative figures. No Three.js on the home screen (CLAUDE.md), no image or
  video files, no third-party assets. Placeholder sports get a simple loop too.
- **Reduced motion:** under `prefers-reduced-motion` the loops and the logo show
  one still frame, and the cursor does not animate.
- Keep the page light: no layout shift while loops start; pause loops when the
  tab is hidden.

## Done when
- [ ] Cursor arrow shows on the home screen with the mouse, not on touch.
- [ ] Each sport's thumbnail loops; reduced motion shows a still (e2e checks the
      media query).
- [ ] Both viewports: no horizontal scroll, nothing clipped; screenshots in
      `docs/`.
- [ ] Home screen still has no Three.js import (`spec` or build check).
- [ ] e2e passes at both viewports.
