# 13 Wii-style home screen

Status: planned (building)
Model: Opus (visual design judgment)
Waits on: nothing (touches client/ui/menu.ts, client/main.ts, client/style.css,
tests); can run beside task 12, which is sim-only

## Goal
A new home screen for Weblympics in the spirit of Wii Sports / Wii Sports
Resort. Reference: `design/reference/WiiSports-Menu.webp` (local only, a
third-party screenshot: take the look, not the assets; no Nintendo logos,
"Wii" text or Mii likenesses, see design/inspiration.md).

## Layout (user's brief, top to bottom)
1. **Title:** "Weblympics".
2. **Thumbnail** below it: a framed preview of the selected sport. It changes
   when another sport is focused or hovered. Tennis shows a low-poly court
   built from DOM/CSS or an inline SVG (no Three.js on the menu: that stays
   lazy, loaded only once a game starts; no image assets to ship).
3. **Sport buttons** below the thumbnail, one per sport, on theme.

## Look (from the reference)
- Pale sky-blue to white background, soft and bright (not the current dark card).
- Glossy rounded "pill" buttons with a bright rim and a light inner gradient;
  the focused/selected one is highlighted and has a pointer hand cursor-style
  marker (an arrow or hand drawn in CSS/SVG, not a Nintendo asset).
- A framed preview panel with a thin border and rounded corners.
- A small "Main Menu" tab at a corner is optional; keep the title as the hero.
- Keep the existing decorative Mii-style court sprites if they still fit.

## Sports
- Driven by a list (name, id, playable, blurb, thumbnail), so adding a sport is
  one entry. **Tennis is the only playable sport** (CLAUDE.md: no second game
  until the core is solid). Other sports are not added unless the user asks;
  if the user wants "coming soon" placeholders on the menu, they are disabled
  buttons labelled so, never clickable and never sent to the server.
- The room actions (practice vs bot, create a room, join by code, sign in as a
  demo user or guest) stay reachable: a sport button opens that sport's
  options (practice / create / join) without removing any current action.
  Training mode (task 5) will slot in here later.

## Accessibility and viewports
- 1920x1080 and 390x844: no horizontal scroll, buttons reachable, nothing
  clipped. On a phone the thumbnail shrinks above the buttons.
- Fully keyboard operable (arrow keys move between sports, Enter selects, Tab
  order sensible, visible focus ring); screen-reader names; respects
  `prefers-reduced-motion`; contrast checked for the pale background.
- Works with no camera and no network beyond the page itself.

## Done when
- [ ] New home screen in `client/ui/menu.ts` (+ CSS) matching the layout above.
- [ ] Sports come from a list; Tennis starts a practice/room exactly as before.
- [ ] `e2e/layout.e2e.ts` menu test still passes and a new e2e covers: title,
      thumbnail, buttons order (top to bottom), keyboard navigation, both
      viewports, no horizontal scroll.
- [ ] Screenshots of both viewports checked by eye and kept in `docs/`.
- [ ] README and CLAUDE.md layout line updated if the files change.
