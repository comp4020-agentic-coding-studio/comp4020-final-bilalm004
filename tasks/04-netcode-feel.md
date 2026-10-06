# 04 Netcode feel

Status: not started
Model: Opus

## Goal
Hits feel fair for two players on real networks. The server stays the only
authority on the ball.

## Scope
- Clock offset estimate (ping/pong handshake) so a swing carries a client
  timestamp the server can place on its own timeline.
- Server resolves a swing at its claimed time within a bounded rewind (reject
  anything older than a cap, so it can't be abused to hit late).
- Client rendering: interpolate between snapshots instead of the current
  extrapolation from the last one; handle bounces smoothly.
- Hit feedback: instant local racket animation, ball reacts on next snapshot.
- Tune: ball speed, hit window, snapshot rate (currently 30 Hz) against
  measured latency.

## Done when
- [ ] Simulated 100-150 ms latency and jitter: a swing on time still hits.
- [ ] A swing claiming an old timestamp beyond the cap is ignored (spec test).
- [ ] Swing-to-ball-reaction latency is logged (feeds task 08) and the numbers
      are in PROCESS.md.
- [ ] Sim stays deterministic; existing `spec/sim.test.ts` still passes.

## Notes
This changes `shared/` and `server/`, so run `pnpm check` unprompted.
