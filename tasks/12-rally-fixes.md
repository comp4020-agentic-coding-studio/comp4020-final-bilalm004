# 12 Rally fixes: out balls, dead ball, hit window

Status: in progress (auto-move is merged); out-ball rule widened after a second playtest report
Model: Opus
Waits on: 2 (auto-move changes who can reach what, and the same rallies)

## Why
User playtest: "if I hit it out I still get the point", "the bot hits it back
and I get the point", and "the window between early / on time / late goes by so
quickly". Probes against the real sim and bot (devlog, 2026-10-15) found:

1. **The bot volleys balls that are going out.** A long ball (landing about 3 m
   past the bot's baseline) is returned in the air by the bot every time, so the
   rally goes on and whoever misses next loses. Legal, but poor play: a person
   would let it go.
2. **A swing still counts after an out ball has landed.** For about 5 ticks
   (80 ms) after it lands, `missReason` accepts a swing as a hit (the hit window
   reaches about 3 m past the baseline, further than the court), which cancels
   the pending "out" point.
3. **The timing window is short.** `HIT_WINDOW_S` is 0.22 s either side of the
   baseline, so early / on time / late are about 0.15 s each.

## Decisions (agreed with the user, numbers to tune)
- Bot lets balls go that will land out, and still plays balls that land in.
  Keep bot-vs-bot mean rally length in the 3.8-3.9 band.
- **A shot that will land out is dead from the moment it is hit** (user report,
  second playtest: "the trajectory pointed out, I hit it, it went out, but the
  bot hit the out ball and it wasn't counted as out"). At launch the sim runs
  the shot forward with the same `moveBall` to its first touchdown; if that is
  out of bounds (or into the net, or on the hitter's own side) the ball is
  dead: the receiver's swing at it is a miss, the bot doesn't swing at it, and
  the point goes to the receiver when it lands, as the umpire's "out". This
  also closes the 80 ms window after an out ball lands. A ball that will land
  in can still be volleyed. Check against ADR 001: the flag belongs to the
  ball since launch, so rewind from an earlier tick stays deterministic and a
  lagged swing at a ball that was in is unaffected; add a note to the ADR.
- Widen the hit window to about 0.32 s (each third about 0.21 s). Check the
  cost: hitting gets easier and early/late aim changes more gradually; keep the
  aim spread per strength sensible.

## Done when
- [ ] Test: the bot lets a ball go that lands out, and returns one that lands in
      (fails on current code).
- [ ] Test: a swing at a shot that will land out is a miss, in the air and after
      it lands; a volley of a ball that will land in still works; a rewound
      swing at a ball that was in still counts.
- [ ] Test: the hit window is the new value and each third of it is the length
      stated here.
- [ ] Rally length band and strength balance re-measured and written in the
      devlog.
- [ ] `pnpm check` and `pnpm e2e --workers=1` green on the merged tree.
