# 12 Rally fixes: out balls, dead ball, hit window

Status: in progress (auto-move is merged); out-ball rule revised after the user's ruling that a ball going out can be hit or left
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
- **A ball that is going out can still be hit, or left alone (user ruling,
  overriding the first draft of this task).** Volleying a ball that is going
  out is legal tennis, so a player may hit it or let it go; if they let it go
  and it lands out, the point is theirs (the umpire's "out"). Only the bot
  changes: it forward-simulates the ball with the same `moveBall` (as
  `predictLanding` does), and when the ball will land out it does not swing,
  while it still returns balls that will land in.
- **Once a ball has landed out it is dead:** no swing can hit it, which closes
  the 80 ms window where a swing after an out ball landed was accepted and
  cancelled the pending "out" (the user's "I hit it out and still got the
  point"). ADR 001 still holds: a lagged swing at a ball that was still in the
  air is rewound and counts; only a swing judged after the bounce is refused.
- Widen the hit window to about 0.32 s (each third about 0.21 s). Check the
  cost: hitting gets easier and early/late aim changes more gradually; keep the
  aim spread per strength sensible.

## Done when
- [ ] Test: the bot lets a ball go that lands out, and returns one that lands in
      (fails on current code).
- [ ] Test: a swing at a ball in the air that will land out is still a hit (the
      player's choice); a swing after it has landed out is a miss; a rewound
      swing at a ball that was still in the air counts.
- [ ] Test: the hit window is the new value and each third of it is the length
      stated here.
- [ ] Rally length band and strength balance re-measured and written in the
      devlog.
- [ ] `pnpm check` and `pnpm e2e --workers=1` green on the merged tree.
