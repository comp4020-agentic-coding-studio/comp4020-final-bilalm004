# ADR 001: Who wins when lag makes the players' screens disagree

Status: accepted, 2026-10-14. Implementation: `tasks/done/netcode-feel.md`.

## In plain terms

The server counts 60 ticks a second, and every state it sends says which tick
it is from, so a player's screen always knows which tick it is showing.

Alice has a 100 ms round trip. Her screen shows tick 500 when she swings, so
her swing says "I was looking at tick 500". Lag gets it to the server at tick
506. Judged at 506 the ball may be past her and she misses. Instead the server
goes back to its own record of tick 500 and checks the ball there.

It won't go back as far as anyone asks. It allows her measured round trip plus
50 ms (here 150 ms, 9 ticks), and never more than 9 ticks for anyone. If she
claimed tick 480, it would still only go back as far as her limit allows, so
claiming more lag buys nothing.

## Reading the logs

Every swing writes a `swing_resolve` line. Two fields say what rewind did:
`allowed` is how many ticks back the server was willing to judge this swing,
and `rewind` is how many it actually used. It uses them only if the ball was
hittable back then; otherwise it judges at arrival, as before.

| `allowed` | `rewind` | `outcome` | Meaning |
|---|---|---|---|
| 0 | 0 | any | No rewind possible: no measured lag yet, or no tick sent |
| 6 | 6 | hit | Lag would have made it a miss; rewind saved it |
| 6 | 0 | late | Late even on the player's own screen |
| 6 | 0 | hit | On time even without rewind |

Until the client sends the tick it is showing (task 04 step 4), every real
player's swings log `allowed 0`.

## Context

The server owns the ball. It steps the sim at 60 Hz and broadcasts the state
30 times a second. Every player sees the ball a little in the past: half a
round trip, plus up to one broadcast interval. Their swing then takes another
half a round trip to reach the server.

Today a swing is judged when it arrives. With 60 ms each way, a swing that was
on time on the player's screen is about 120 ms late on the server. At rally
speeds the hit window was then 0.22 s either side of the baseline
(`HIT_WINDOW_S`, `shared/games/tennis/sim.ts`; 0.32 s since task 12), so that
lag spends over half of it. On-time swings come back "too late", and how often depends on the
player's connection, not their timing.

When the two screens disagree, someone's view has to win. This is the
multi-user decision crit 9 asks for.

## Options

**A. Server time only (today).** Judge a swing against the ball as it is when
the swing arrives.
- Gains: simplest; nothing to trust, nothing to cap.
- Costs: lag silently shrinks the hit window, more for the player with the
  worse connection. On-time swings miss, and the game feels broken to the
  person who swung.

**B. Wider hit window.** Keep judging at arrival, but accept balls further
past the baseline.
- Gains: one constant to change.
- Costs: everyone gets the same slack whatever their lag. A low-lag player can
  hit balls that really were late; a high-lag player may still not get enough.
  Timing stops meaning anything precise.

**C. Show the ball ahead of server time.** The client draws where the ball
will be, so the player swings at the server's present.
- Gains: no rewind on the server.
- Costs: the guess is wrong every time the opponent hits, so the ball visibly
  jumps on every return. Doesn't fix the swing's own trip to the server.

**D. Judge the swing at the moment the hitter saw, within limits (chosen).**
The swing carries the server tick the player's screen was showing. The server
keeps a short history of its own states, checks the hit against the ball and
player as they were at that tick, and if it connects, replays forward from
there.

## Decision

Option D. When lag makes the screens disagree, the server sides with what the
hitter saw at the moment they swung, judged against the server's own record of
that moment and bounded so it can't be abused:

1. **The server checks, the client never claims.** A swing says only "I was
   looking at tick T". The server looks up its own state at T and runs the
   same `missReason` check as today. A client's claim of a hit or a score is
   still never trusted (CLAUDE.md rule).
2. **Bounded by measured lag.** The server pings each player and keeps a
   recent round-trip time. A swing may reach back at most that player's
   round trip plus a small jitter margin, and never more than 150 ms. A
   claimed tick older than that is treated as the oldest allowed tick, so
   faking lag buys nothing.
3. **Points are final once confirmed.** A ball that goes past the receiver
   (unreturned, or landing out on their side) is decided at once but scored
   150 ms later, the same as the rewind cap, while it carries on flying. A
   rewound hit in that gap cancels it. Once scored, a point is never undone:
   rewind never crosses it. A ball into the net or onto the hitter's own side
   never reached the receiver, so it scores at once. *(Added after measuring:
   without the delay, the point was scored before a lagged on-time swing could
   arrive, and rewind refused it. At 150 ms that left the hit rate at 64%.)*
4. **A miss is still a miss.** If the ball was outside the window or out of
   reach at tick T, it misses. Rewind removes lag, not bad timing.
   *(Task 12, the dead ball:)* a ball that has landed out, or bounced twice,
   is dead from that tick: `missReason` says `"out"` or `"two bounces"`. A
   swing judged at a tick before that touchdown is unaffected, so a lagged
   swing at a ball that was still in the air is rewound and counts (and
   cancels the pending point); only a swing judged after it is refused.
   Whether a ball is dead is part of the state at each tick (the pending
   point's `dead` flag), so rewinding to an earlier tick replays it exactly.
   A ball still in the air that is going out stays live: the receiver may
   volley it or leave it. A ball flying past the receiver's end is only
   decided once it is also past their hit window, so the wider window never
   scores a point while a lagged swing could still reach it.
5. **The hitter sees an on-time return.** On swing the client plays the racket
   animation and a hit sound at once, but leaves the ball on the server's
   path. When the confirming state arrives, the return is drawn from where the
   ball is now (the shared sim run forward from the hit tick), not from the
   racket, so it never looks like it hung on the strings.
6. **Spectators watch about 100 ms behind live**, interpolating between
   states, so they never see a correction.

## Consequences

- **The opponent pays.** When the hitter's swing is accepted late, the
  opponent's screen showed the ball carrying on for a moment, then reversing
  already partway back: about 0.7 m at 50 ms lag, 2 m at 150 ms. It happens at
  the far end of their court, where the ball is smallest, and is blended over
  a few frames.
- **High-lag players get less benefit of the doubt.** Above the 150 ms cap the
  oldest part of the delay is no longer forgiven. That's deliberate: a 1 s
  connection can't be allowed to hit balls that are long gone.
- **More server work.** About 10 ticks of state history per room, and a
  replay of up to 9 ticks on an accepted late swing. The sim is small and
  deterministic, so this is cheap and stays testable from seed plus inputs.
- **Determinism is unchanged.** A rewound hit is an input applied at an
  earlier tick and replayed; the same seed and input stream still give the
  same match.
- **The score shows 150 ms late** for a ball that goes past the receiver.
  Nobody watching notices; the ball is already flying away.
- **It's measurable.** Every swing logs the server tick, how far back it was
  allowed, how far back it was judged, the player's round trip and the
  outcome (`swing_resolve`); every point logs its winner, shots and reason
  (`rally`).

## Measured

`spec/latency.test.ts` runs the real sim and the server's rewind rule with the
network modelled in ticks. 400 swings per row, timed evenly across the hit
window as seen on the player's own screen, so all of them hit with no lag:

| Round trip | Rewind off | Rewind on |
|---|---|---|
| 0 ms | 100% | 100% |
| 50 ms | 89.5% | 100% |
| 100 ms | 81.3% | 100% |
| 150 ms | 64.5% | 97.8% |
| 200 ms | 56.3% | 89.5% (past the 150 ms cap, by design) |

Re-measured with task 12 (0.32 s window, and a test ball that lands in; the
old one landed about 3 m long, which is now a dead ball after it lands):
93.0 / 87.5 / 76.2 / 70.8% without rewind at 50 / 100 / 150 / 200 ms, and
100 / 100 / 100 / 95.8% with it. The wider window leaves lag a smaller share
of it, so rewind off improves too.

Checked on every `pnpm check`: at least 95% at 150 ms with rewind, under 85%
without it, and rewind never lowers the rate. The cap itself (measured round
trip plus margin, never over 150 ms, nothing for unmeasured lag) and "never
across a point" are unit-tested in `spec/sim.test.ts`.
