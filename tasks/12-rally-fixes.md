# 12 Rally fixes: out balls, dead ball, hit window

Status: done (devlog 2026-10-15 04:05); 0.32 s window and the bot's let-go rule open to playtest
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
  Bot-vs-bot mean rally length is a sanity check only (collapse under ~2.5 or
  run-on over ~8 would be a problem), not a target.
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

## How it works (as built)
- `missReason` returns `"out"` once the ball has landed out and `"two bounces"`
  once it has bounced twice: the pending point carries `dead: true` from that
  touchdown. A ball in the air going out is still hittable. The flag is part
  of the state at each tick, so rewind to an earlier tick replays it exactly.
- `willLandIn(s)` runs the ball on with `moveBall` to its first touchdown;
  the bot swings only when it is true (or the ball has already bounced in).
- `HIT_WINDOW_S` 0.32; `SWING_LEAD_TICKS` follows it (16 -> 22 ticks).
  `timingAim` and the aid's thirds derive from `hitWindowDistance`, unchanged.
- Found by the point sweep and fixed: a ball past the end was decided at
  `endMargin` (3 m), which the wider window now reaches past (4.5 m at
  14 m/s), and at either end, so a late hit from deep behind your own
  baseline was called "out" against you on the same tick. Now only the
  receiver's end, and only once past their window too. Without the window
  part, 150 ms lagged swings fell to 85% hits (points scored before they
  arrived).
- `predictContact`: a ball that lands out before the baseline has its
  contact at its last tick in the air (still volleyable, so the camera client
  still sends the swing), and none once it has landed.
- Client: "Too late: the ball had already landed out / bounced twice" on the
  shot label, from the hint and from the server's ruling.

## Measured (before -> after)
- Bot-vs-bot mean rally (200 seeds x 2 min, endless): 3.914 -> 3.918. Every
  bot point ends wide (441/441), and a wide out ball lands beside the court
  before the bot's swing zone, so the let-go rule never fired in bot play
  (0 ticks); the bot also times its swing from its own zone, not the window.
- Auto reach from the far sideline: straight 100/100/100% both; full aim
  light/medium/hard 100/50/0% both. `spec/auto-move.test.ts` bands unchanged.
- Auto-moved receiver in reach on the side auto set up, every tick of every
  third (60 seeds of bot play): 100% before and after.
- Timing-aimed shots over the whole window landing out, light/medium/hard:
  2/2/14% -> 0/2/15%. Aim spread unchanged.
- Lag (spec/latency.test.ts, fixture now lands in): rewind on 100% at
  150 ms, off 76%.

## Done when
- [x] Test: the bot lets a ball go that lands out, and returns one that lands in
      (fails on current code). `spec/rally-fixes.test.ts`.
- [x] Test: a swing at a ball in the air that will land out is still a hit (the
      player's choice); a swing after it has landed out is a miss; a rewound
      swing at a ball that was still in the air counts.
- [x] Test: the hit window is the new value and each third of it is the length
      stated here.
- [x] Rally length band and strength balance re-measured and written in the
      devlog.
- [x] Point-consistency sweep (40 seeded matches, a careless swinger vs the
      bot, an independent referee): every point agrees with where the ball
      landed and who hit it last.
- [x] `pnpm check` and `pnpm e2e --workers=1` green (worktree branch, on top
      of main 18d5b8b).
