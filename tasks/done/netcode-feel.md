# 04 Netcode feel

Status: built (steps 1-4); real round trips from the deployed app still to
record in PROCESS.md. Spectator delay (part of step 4) not done.
Design in `docs/adr/001-who-wins-under-lag.md`.
Model: Opus

## Goal
Hits feel fair for two players on real networks: a swing that was on time on
the player's screen counts, within limits. The server stays the only
authority on the ball.

## Plan (in order; measure before changing behaviour)

1. **Measure.**
   - Server pings each client every 2 s (`ping`/`pong` messages carrying the
     server tick); keeps a recent round trip per client.
   - Log `swing_resolve` per swing: room, seat, claimed tick, server tick,
     rewind used, round trip, outcome (hit or miss reason).
   - Log `rally` per point: shots in the rally, how it ended.
2. **Latency harness (spec).** `spec/latency.test.ts`: the real sim and the
   server's rewind rule, network modelled in ticks, swings spread across the
   on-screen window. Runs in about 1 s inside `pnpm check`. (A first version
   through a real delaying WebSocket proxy took minutes per run and had a
   counting bug; replaced.)
3. **Server rewind.**
   - Swing message gains `tick` (the server tick the client's screen showed).
   - Room keeps the last ~10 ticks of sim state plus the inputs applied.
   - On a swing: clamp the claimed tick to max(now - rtt - margin,
     now - 9 ticks, last point change), check the hit at that tick, and if it
     connects, apply it there and replay to now. Otherwise judge it at now as
     today.
   - Sim needs a clone/restore of `TennisState` (rng included) so replay is
     deterministic.
4. **Client.**
   - Track the server tick on screen (last state's tick + time since it
     arrived), send it with every swing.
   - Run the shared `step()` between states instead of the current straight
     projection, so bounces are drawn exactly.
   - On swing: racket animation and hit sound at once; ball stays on the
     server's path. On a confirming state, draw the return from where it is
     now, with a short blend.
   - Spectators: interpolate ~100 ms behind live.
5. **Re-measure** with the harness, put both hit rates and real-game round
   trips from the logs into PROCESS.md and the ADR.

## Done when
- [x] Simulated 150 ms round trip: a swing on time on screen hits at least
      95% of the time (97.8%; 64.5% without rewind).
- [x] A swing claiming a tick older than the cap is judged at the cap, and
      rewind never crosses a scored point (spec).
- [x] Rewind never exceeds a client's measured round trip plus margin (spec).
- [x] `swing_resolve` and `rally` lines appear in the server log (feeds 08).
- [ ] Hit rates before and after, and real round trips, are in PROCESS.md
      (rates are in the ADR; real round trips need play on the deployed app).
- [x] Sim stays deterministic, rewound or not; `spec/sim.test.ts` passes.
- [x] Client sends the tick on screen with swings, and the server allows
      rewind for a real browser (e2e, both viewports).
- [ ] Spectators watch ~100 ms behind live (optional; not done).

## Notes
This changes `shared/`, `server/` and the protocol, so run `pnpm check`
unprompted. The client part is a UI change too: run `pnpm e2e`.
