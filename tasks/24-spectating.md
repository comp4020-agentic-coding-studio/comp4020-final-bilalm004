# 24 Spectating mode

Status: not started, and not to be implemented yet (user, 2026-10-21: write it
down as a deliverable only). Plan it with the user when it is picked up.
Model: Opus (rooms, privacy and what spectators may see)
Session: later

## Where it stands today
- A third arrival to a room becomes a spectator automatically: no queue, no
  seat (CLAUDE.md room rules). `server/room.ts` keeps a `spectators` set; the
  server sends `presence` with a spectator count; the ready panel says
  "Spectating. The match starts when both players are ready."
- Spectators already see crowd and banner effects as they arrive (tasks 16 and
  19), by seat.
- There is no public room list: rooms are invite link or code only, and that is
  a rule. A spectator can only arrive with the link.

## Questions to settle with the user
- How does someone start watching: a "Watch" link a player shares, or a list of
  live matches? A list would change the "no public list" rule; if wanted, only
  rooms whose host opts in.
- What a spectator sees: the match, the score, the crowd, a count of watchers,
  and whether names show. Spectator-to-player chat stays out (preset phrases
  only, per `parked.md`).
- Spectator limits (a cap per room for the 256 MB machine) and what happens at
  the cap.
- Winner-stays-on queue (parked) versus plain spectating: keep them separate.
- Whether a spectator sees a live view with sound and the cheering crowd.
- Mobile layout: a watcher on a phone at 390x844.

## Rules to keep
- Spectators never send input; the server ignores any swing or ready from them
  (hostile-client test).
- Video never leaves the browser; spectators get no camera.
- The server stays the only owner of the ball and score.

## Done when (to be refined)
- [ ] Decisions above recorded in this file and CLAUDE.md.
- [ ] Spectator join path, limits and view, both viewports.
- [ ] Hostile-client test: a spectator's input is rejected.
- [ ] README, CLAUDE.md room rules and `spec/` agree.
