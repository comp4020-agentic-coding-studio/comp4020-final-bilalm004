# 14 Weblympics colours and logo

Status: queued
Model: Opus (visual design judgment)
Waits on: nothing; touches client/style.css and client/ui/menu.ts (the home
screen from task 13), so run it before or after other home-screen work, not
beside it

## Goal
Weblympics gets its own look: the Olympic colours (blue, yellow, black, green,
red) and a fun logo, so it reads as a games and not a plain title.

## Scope
- A logo mark built from CSS/SVG (no image files): the title "Weblympics" with a
  playful treatment and a ring motif in the five Olympic colours. Do not copy
  the official Olympic rings or any IOC trademark exactly; use a distinct
  interlinked ring or circle motif of our own, in the same palette.
- Use the palette across the home screen and the game UI (buttons, score bar,
  accents), keeping text contrast at WCAG AA or better (the Olympic yellow and
  light blue on white need care).
- Fun, in the Wii spirit: rounded, bouncy, slightly animated (off with
  prefers-reduced-motion).
- The logo is **animated** (user, 2026-10-21): letters bounce in once on load,
  then the rings gently float or spin on a slow loop; pure CSS/SVG, one still
  frame under reduced motion. The pointer and thumbnail loops are task 23, run
  right after this one in the same session.

## Done when
- [ ] Logo and palette on the home screen at 1920x1080 and 390x844, no clipping.
- [ ] Contrast checked for text and controls; screenshots kept in docs/.
- [ ] e2e still passes at both viewports.
