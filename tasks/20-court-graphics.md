# 20 Court and stadium graphics

Status: queued
Model: Opus (visual judgment; look at screenshots at both viewports)
Session: C

## Goal
The arena looks better, still low-poly and flat-shaded, with no post-processing
and no heavy assets.

## Scope
- Improve `client/games/tennis/stadium.ts` from primitives only: court surface
  and line detail, net and posts, umpire chair, ball kids or banners, lighting
  and sky, nicer stands. The Olympic colours from task 14 apply if that has
  landed; do not block on it.
- Keep the crowd as instanced meshes with a per-seat grouping that task 19 can
  drive (left stand, right stand, front stand split in half). Do the layout in
  this task; the reactions are task 19.
- Budget: the trail and camera e2e tests are frame-rate sensitive. Do not lower
  the frame rate; check triangle and draw-call counts before and after and
  record them in the devlog.
- Look at the result in a real browser at 1920x1080 and 390x844 and say what you
  saw. Nothing may clip the ball, the players or the HUD.

## Done when
- [ ] Before/after screenshots at both viewports are saved in `docs/` and
      linked from the devlog.
- [ ] Draw calls and triangles recorded; frame-rate e2e tests still pass.
- [ ] The crowd groups are addressable by side for task 19.
- [ ] No new assets or third-party code; CLAUDE.md layout updated.
