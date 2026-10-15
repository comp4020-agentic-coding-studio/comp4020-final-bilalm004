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

## One player on two tabs (flagged)
Allowed for now so one person can test with two tabs (same browser token or the
demo accounts). Task 4 settled two parts: a match where both seats share a
token is stored unrated, and a held seat goes to the next tab with that token
to join. A "replace the old tab" or "reject the second tab" policy, and
renaming (with length and character limits), can come with accounts.

## Calibrate light / medium / hard, for forehand and backhand (to discuss)
The user wants to discuss a per-player calibration of the three swing strengths,
separately for forehand and backhand. Not started; the questions come first.
What exists today (read from the code, not tested with a real webcam):
- A swing's strength comes from peak wrist speed in shoulder-widths per second,
  split at two thresholds (default 5 and 9, `DEFAULT_SWING` in `pose.ts`), with a
  10% hysteresis so a steady swinger doesn't flicker between levels.
- One pair of thresholds serves both strokes, and `thresholdsFrom` can set it
  from a player's own light, medium and hard swings.
- That tuning was taken out of the default setup (it measures in shoulder-widths,
  so distance and body size are already normalised); it is only behind "Calibrate
  manually" in the camera panel's Advanced section.
- The sim treats the strokes differently: a backhand hard is 16.5 m/s against 18
  for a forehand (`STROKES` in `sim.ts`).
Questions for the discussion: does a backhand swing read slower than a forehand
for the same effort (grip and arm path differ, so the same thresholds may be
wrong for one of them)? Is a quick guided calibration (three swings per stroke)
worth the setup time, or should it learn from play? What does the player see
while doing it, and can keys and touch skip it as they do now?
