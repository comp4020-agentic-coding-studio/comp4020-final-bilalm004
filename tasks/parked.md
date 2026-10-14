# Parked: potentially later

Status: parked, nothing here is committed to
Model: Opus when picked up

## Accounts and profiles
- Anonymous persistent profile first (random id in a cookie, no passwords);
  passkeys (public keys only, safe for open source) or Google OAuth (secret in
  `fly secrets`) to claim or recover it.
- Character customisation from an enum-validated palette; stats from the
  `matches` table (wins, aces, longest rally).
- Ratings only for profiles; guests still get full scoring.
- Preset quick-chat phrases, no free text.
- Keep README, CSP and spec consistent with whatever is stored; no credentials
  in logs.

## Room codes
Short codes to join a room. Invite links already do this job, so only worth it
if profiles make "send a code to a friend" useful.

## Swing double-count fix
One swing sometimes counts as two (wind-up then forward swing, or the return
stroke). Fix when picked up: count only motion in the hitting direction, a
longer cooldown (about 500-600 ms), and require the wrist to settle before a
new swing. Training mode (task 5) may show it; note instances in the devlog.

## Winner stays on (spectator queue)
A third arrival joins a queue; when a match ends the winner keeps the seat and
the next in the queue takes the loser's. Liked, but built later: today a third
person is a spectator and nothing more. Needs the room state machine from task 4
first, then queue order, leave-the-queue and what a spectator sees.
