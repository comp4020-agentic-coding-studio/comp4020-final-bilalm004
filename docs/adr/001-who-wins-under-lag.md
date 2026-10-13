# ADR 001: Who wins when lag makes the players' screens disagree

Status: accepted, 2026-10-14. Implementation: `tasks/04-netcode-feel.md`.

## Context

The server owns the ball. It steps the sim at 60 Hz and broadcasts the state
30 times a second. Every player sees the ball a little in the past: half a
round trip, plus up to one broadcast interval. Their swing then takes another
half a round trip to reach the server.

Today a swing is judged when it arrives. With 60 ms each way, a swing that was
on time on the player's screen is about 120 ms late on the server. At rally
speeds the hit window is 0.22 s either side of the baseline
(`HIT_WINDOW_S`, `shared/games/tennis/sim.ts`), so that lag spends over half
of it. On-time swings come back "too late", and how often depends on the
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
3. **Points are final.** Rewind never crosses a point change. If the point was
   already scored when the swing arrives, the swing is ignored.
4. **A miss is still a miss.** If the ball was outside the window or out of
   reach at tick T, it misses. Rewind removes lag, not bad timing.
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
- **It's measurable.** Every swing logs the claimed tick, the server tick, the
  rewind used, the player's round trip and the outcome. Hit rate with and
  without rewind at simulated lag goes in `PROCESS.md`.

## How we'll know it worked

- At a simulated 100-150 ms round trip with jitter, a scripted client that
  swings when its own screen shows the ideal moment hits at least 95% of the
  time with rewind, against a measured, lower rate without it.
- A swing claiming a tick older than the cap is judged at the cap (spec test).
- Swing logs show rewind used tracking each player's measured round trip.
