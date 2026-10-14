# 14 Camera setup, grip and tilt

Status: planned
Model: Sonnet, with Opus reviewing the grip and tilt tuning

Supersedes parts of task 03 (calibration, point aim as default).

## Goal
Opening the camera is short, safe and clear, and forehand/backhand and
movement are easier to control.

## Decisions
- **Remove calibration from the default flow.** Neutral capture only matters for
  point aim, and the swing-level calibration duplicates thresholds already in
  shoulder-widths per second. Keep: right/left hand, and a "can we see your
  shoulders and arm" check. Neutral capture and level tuning may live in an
  optional Advanced section.
- **Safety notice** before "Start camera" (and in training): clear the space,
  1.5-2 m from the screen, no loose jewellery or watches, hair and sleeves
  clear, hold nothing, don't swing at full force, take breaks. A "got it"
  button; "don't show again" is a per-viewer convenience only.
- **Grip stays the forehand/backhand signal** (palm to camera is forehand, back
  of hand is backhand); direction is not a second signal, because two signals
  that can disagree feel worse than one rule. Make it reliable: smooth the
  reading, lower the 0.3 threshold, lock the grip once a swing starts, and show
  the detected grip on screen at all times. If playtests still show false
  misses (see task 12), fall back to picking the kind from the ball's side.
- **Forehand vs backhand look different:** check `character.ts` animation and
  add a brief shot label.
- **Easier tilt, tilt stays:** auto-neutral from the first second of tracking,
  a smaller range or response curve (16 degrees may now be too much; 9 was too
  little), and an on-screen tilt gauge showing the dead zone and edges.

## Done when
- [ ] Unit tests in `pose.ts` for grip smoothing/locking and tilt auto-neutral.
- [ ] Camera panel: notice, hand choice, visibility check, both viewports.
- [ ] Every camera action still has a keyboard/mouse equivalent.
- [ ] Real-webcam playtest notes in the devlog.
