# Dev log

Append-only record of decisions and key events, newest at the bottom. Copy
the format of the entries below (see CLAUDE.md, Docs).

## 2026-10-14 02:49 AEDT | decision | Crit 9 is the current crit, not crit 10

- **Situation:** Asked what this week's crit requires. First answer said crit 10
  because weeks were counted from 2026-07-27 without the teaching break.
- **Decision:** Treat this as crit 9 "All at once" (week 10): the final project
  goes real-time, plus one recorded multi-user decision. Lab is Wed 14:00
  (group yunlin), cutoff Wed 12:00.
- **Why:** The user's lab day matched crit 9, and the crit-groups API dates the
  week-9 holiday exception at 2026-10-06, which puts today in week 10.
- **Follow-up:** Real-time sync within ~1s with no reload; ADR for the
  multi-user behaviour; `reflections/crit-9.md`.

## 2026-10-14 02:49 AEDT | config | Repo default model set to Sonnet 5.5

- **Situation:** Sessions launched on Sonnet 5.
- **Decision:** Set `ANTHROPIC_MODEL` to `claude-sonnet-5-5` in
  `.claude/settings.local.json` (gitignored, so not committed).
- **Follow-up:** Takes effect on the next new session.

## 2026-10-14 03:23 AEDT | decision | Under lag, the hitter's view wins, within limits

- **Situation:** Crit 9 needs one recorded multi-user decision. Swings are
  judged when they reach the server, so lag (about 120 ms round trip) spends
  over half the 0.22 s hit window and on-time swings come back "too late".
  Nothing measures lag today.
- **Decision:** Judge each swing at the server tick the player's screen
  showed (rewind), checked against the server's own history. Capped at the
  player's measured round trip plus margin, never over 150 ms, never across a
  point change. Client plays the hit instantly and draws the confirmed return
  from where it is now. Written up as `docs/adr/001-who-wins-under-lag.md`.
- **Why:** Rejected server time only (lag silently eats the window, worst for
  the slower connection), a wider window (same slack for everyone, timing
  stops meaning anything) and drawing the ball ahead (jumps on every return).
  The cost lands on the opponent as a small late correction at the far end of
  their court.
- **Follow-up:** Build per `tasks/04-netcode-feel.md`: measure first (ping,
  `swing_resolve` logs, latency harness baseline), then rewind, then client.
  Spin shots for classic + timing parked until after.

## 2026-10-14 03:30 AEDT | event | ADR 001 is lag compensation, an industry standard (checked)

- **Situation:** Asked whether the rewind approach is used in real games.
  Answered from memory first, then checked each claim against sources.
- **Outcome:** Yes. The technique is called **lag compensation**: the server
  rewinds to what the player saw when the input was sent. Confirmed:
  - **Valve, Source engine:** Yahn Bernier, "Latency Compensating Methods in
    Client/Server In-game Protocol Design and Optimization", GDC 2001; uses
    Half-Life and Counter-Strike as examples. The Valve wiki defines lag
    compensation as rewinding time by the player's latency, and Source draws
    other players 100 ms in the past by default (`cl_interp 0.1`), as we plan
    for spectators.
  - **Overwatch (Blizzard):** "favor the shooter", in Tim Ford's own words
    (2016 dev update, later forum post on hit registration), with deliberate
    exceptions when the target uses an evasive ability.
  - **Rollback (GGPO, Tony Cannon, ~2006):** restore a saved state, apply the
    late input, resimulate to the present; needs a deterministic sim. Standard
    in fighting games (Street Fighter 6, Guilty Gear Strive). Our replay after
    an accepted late hit is this idea.
- **Corrections to what I said from memory:**
  - Source does cap the rewind (`sv_maxunlag`), but it keeps about 1 s of
    history and defaults to about 1 s, not 150 ms. Our 150 ms cap is far
    stricter than Source's.
  - "Favor the shooter" is from Ford's 2016 statements, not his GDC 2017
    netcode talk.
  - Valorant does rewind on the server (third-party summary), but Riot's stated
    goal is the opposite emphasis: a player holding a position should, on
    average, beat one peeking. Not a clean "favour the shooter" example.
- **Why it matters:** Answer for the pod arguing for server time only. This is
  how Source and Overwatch handle hits, adapted for a moving ball by replaying
  it forward, as rollback does. Known cost in shooters, "shot behind cover",
  is the same as ours: the opponent sees a late correction.
- **Sources:**
  [Bernier 2001](https://www.semanticscholar.org/paper/Latency-Compensating-Methods-in-Client-Server-and-Bernier/330071040ca858ca710a24a03915366fcd46f021),
  [Valve: Lag Compensation](https://developer.valvesoftware.com/wiki/Lag_Compensation),
  [Valve: Source Multiplayer Networking](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking),
  [GDC Vault: Overwatch Gameplay Architecture and Netcode](https://gdcvault.com/play/1024001/-Overwatch-Gameplay-Architecture-and),
  [Kotaku on Overwatch tick rate](https://kotaku.com/overwatchs-low-tick-rate-can-be-a-problem-1778708854),
  [Riot: Peeking into VALORANT's Netcode](https://www.riotgames.com/en/news/peeking-valorants-netcode),
  [SnapNet: Rollback](https://www.snapnet.dev/blog/netcode-architectures-part-2-rollback/).
- **Follow-up:** Add a "prior art" paragraph to ADR 001 citing Bernier and
  rollback.

## 2026-10-14 03:40 AEDT | milestone | Task 04 step 1: lag is now measured

- **Situation:** Rewind needs each player's real round trip (to cap it) and
  a record of how swings are judged. Neither existed.
- **Outcome:** Server pings every client every 2 s and keeps a smoothed round
  trip; client answers pings. `step()` now returns events, and the server logs
  `swing_resolve` (room, seat, name, tick, rewind, rtt, outcome) per swing and
  `rally` (winner, shots, reason) per point. The swinger also gets the ruling
  back as a `swing` message. No gameplay change.
- **Tests written:** `spec/sim.test.ts` "step events" (hit then point with
  reason and shot count; miss reason matches `missReason`; serve swing is
  "no ball"; serve counts as shot 1 and resets). `spec/rooms.test.ts`: round
  trip is timed (checked it fails with pong handling broken), a pong for an
  unknown ping is ignored, the swinger gets the server's ruling. `pnpm check`
  103/103.
- **Bug found:** `node --watch` does not see edits on the `/mnt/c` drive, so
  the first `pnpm check` ran the new tests against the old server and timed
  out. Fix: restart `dev:server` before checking; noted in CLAUDE.md.
- **Follow-up:** Step 2, latency harness and baseline hit rates.

## 2026-10-14 04:31 AEDT | milestone | Task 04 steps 2-3: rewind built, 64% -> 98% at 150 ms

- **Situation:** Step 1 measured lag; next was a baseline harness, then the
  server rewind from ADR 001.
- **Outcome:** Server judges a swing at the tick the client claims, capped by
  `rewindTicks` (`server/rewind.ts`): the measured round trip plus 50 ms,
  never over 9 ticks (150 ms), nothing without a pong. The tennis adapter
  keeps 12 ticks of state history and replays forward after an accepted
  rewound hit. Logs now show `allowed` and `rewind` per swing.
- **Tests written and results:** `spec/latency.test.ts` (400 swings spread
  across the on-screen window, network in ticks, about 1 s): hit rate rewind
  off / on = 100/100 at 0 ms, 89.5/100 at 50, 81.3/100 at 100, 64.5/97.8 at
  150, 56.3/89.5 at 200. Asserts >=95% at 150 ms with rewind, <85% without.
  `spec/sim.test.ts`: rewind hits a swing that is late now but was on time;
  refuses one that still misses and leaves the game untouched; never crosses
  a point; refuses past its history; a rewound game equals one fed the swing
  live (determinism); cap tests; pending-point tests. `spec/rooms.test.ts`:
  no rewind without measured lag; non-integer tick rejected; room allows
  exactly the claimed ticks when lag covers them. Each key test checked to
  fail with its guard removed. `pnpm check` 124/124 in 21 s.
- **Design change found by measuring:** first rewind run gave no improvement
  at all. Points past the receiver were scored before a lagged swing arrived,
  and "points are final" then refused the rewind. Fix (user chose option 1 of
  3): a ball past the receiver (unreturned, or bouncing out on their side) is
  decided at once but scored 9 ticks later; a rewound hit cancels it. Net and
  own-side balls still score at once. ADR rule 3 updated.
- **Mistakes:** spent about 25 minutes on a real-time WebSocket-proxy harness
  that ran minutes per attempt, printed nothing until done, hung on a
  counting bug, and dropped "no ball" rulings (exactly the misses lag
  causes). User flagged the run time; replaced it with the tick-model test.
  Also briefly imported tennis code into the game-agnostic room; moved the
  cap into `server/rewind.ts` instead.
- **Follow-up:** Step 4, client sends the tick on screen with each swing (real
  players get no rewind until then), then real round trips into PROCESS.md.

## 2026-10-14 04:39 AEDT | event | ADR 001 gets a plain-language example and a log-reading table

- **Situation:** User found "judged at the moment the player saw, limited to
  measured lag plus 50 ms" hard to follow, and asked whether the explanation
  was documented. It wasn't: the ADR had only the formal rules, the devlog
  only that `allowed` and `rewind` exist.
- **Outcome:** Added "In plain terms" (Alice, tick 500 vs 506, the limit, a
  faked claim) and "Reading the logs" (what each `allowed`/`rewind`/`outcome`
  combination means) near the top of ADR 001.
- **Why:** Crit 10 has the author narrate from server logs alone, so the log
  fields need a key that can be read aloud.

## 2026-10-14 04:57 AEDT | milestone | Task 04 step 4: real players now get rewind

- **Situation:** Server rewind was built but no browser sent a tick, so every
  real swing logged `allowed 0`.
- **Outcome:** The game view now runs the latest server state forward with
  the shared sim (at most 9 ticks ahead) and draws that, so bounces and the
  net are drawn exactly and a confirmed return appears already on its way.
  Every swing sends the tick on screen and plays a short Web Audio click at
  once. The screen state never decides anything; each server state replaces
  it. Spectator delay left out (optional).
- **Tests written:** e2e "a swing carries the tick on screen, and the server
  allows rewind for it": four swings in a real browser each carry a
  whole-number tick no more than 9 past the latest state, every ruling has a
  measured round trip, and at least one has `allowed > 0`. Checked it fails
  with the client not sending the tick. `pnpm check` 124/124; `pnpm e2e
  --workers=1` 20/20 at both viewports.
- **Bug investigated, not ours:** first `pnpm e2e` had 3 failures (camera path
  at both viewports, desktop trail). Ran the same tests against HEAD and the
  pre-session commit in a clean worktree on :8090: the trail test failed on
  step-1 code in parallel but passed 3/3 one at a time, and the whole suite
  passes with `--workers=1`. Cause: parallel software-rendered 1080p browsers
  starve the frame rate. Noted in CLAUDE.md: run e2e with `--workers=1` here.
- **Follow-up:** Push and deploy (ask first), then play two real sessions to
  record real round trips and `allowed`/`rewind` from the logs for PROCESS.md
  and `reflections/crit-9.md`.

## 2026-10-14 05:03 AEDT | bug | Privacy e2e broke when the client started sending pong

- **Situation:** Verified commit 85a5e38 against a clean worktree of HEAD
  (another session is editing `client/style.css` and `client/ui/menu.ts`).
  `pnpm check` 124/124, but the camera path e2e failed at both viewports.
- **Cause:** That test allowlists every message type the page may send (the
  "no video leaves the browser" check). Step 1 made the client answer pings
  with `pong`, which wasn't on the list. The other session had already added
  it in the shared tree, which is why my shared-tree e2e run passed.
- **Correction:** The 04:57 entry put all three earlier e2e failures down to
  parallel load. The trail one was load; the camera ones were this bug, and
  my parallel run hid that.
- **Fix:** Added `"pong"` to the allowlist (only that hunk; the other session's
  menu and style work left uncommitted). Clean HEAD camera path e2e now 2/2.
- **Lesson:** With another session in the tree, verify on clean HEAD before
  attributing failures to the environment (already in CLAUDE.md; I checked
  the trail test that way but not the camera one).

## 2026-10-14 05:32 AEDT | bug | Joiner's view cut off: their camera sat inside the end stand

- **Situation:** User reported that the player who joins by invite link sees
  half the page cut off.
- **Cause:** Reproduced with two browsers at both viewports. Page layout was
  fine (both canvases fill the screen); the 3D view was not. The arena was
  built for the seat-0 camera only: end stand, wall segment, trees, clouds
  and hills all at -z. The seat-1 camera sits at z -22, y 9, inside the end
  stand's footprint (z -17.6 to -24.2), so it looked down through the tiers.
  The bottom half of the joiner's screen was one flat green, hiding their
  own player.
- **Fix:** `buildStadium(scene, behindSeat1)` builds the arena (lights
  included) into a group and turns it 180 degrees for seat 1, so the joiner
  gets the host's exact view. Background and fog stay on the scene. Rejected:
  removing the end stand (both ends bare) and moving both cameras (re-tuning
  at two viewports).
- **Test written:** e2e "the player who joins by invite link sees the whole
  court, not a wall": host creates a room, a second browser opens the invite
  link, and the brightness spread over the joiner's near court must exceed
  60. Without the fix it is exactly 0 at both viewports (checked).
- **Verification:** shared-tree e2e had one desktop camera failure (a click
  timeout on "Stop camera"). On a clean worktree of HEAD plus only these
  files, `pnpm e2e --workers=1` passed 22/22, so the failure comes from the
  other session's uncommitted `client/style.css` and `client/ui/menu.ts`.
  Also: my first 8090 check ran against a stale server still holding the
  port; reran on a fresh one.

## 2026-10-14 06:33 AEDT | bug | Flaky rewind test failed CI on a slower runner

- **Situation:** CI run for 8aa0cdf failed `spec/rooms.test.ts` "rewinds a swing
  with measured lag" (expected `allowed` 3, got 4); the next push passed with
  no code change.
- **Cause:** The test claimed `s.tick - 3` and asserted `allowed` was exactly
  3. The server judges at its current tick, so a swing arriving one tick
  late gives `now - claimed` of 4. The assertion depended on wall-clock timing.
- **Fix:** Assert bounds instead of one value: `allowed` is at most
  `min(ruling.tick - claimed, 9)` and at least 3 (the 50 ms margin alone covers
  3 ticks), and `rewind` is at most `allowed`. Exact cap values are still
  pinned in `spec/sim.test.ts`.
- **Verification:** `pnpm check` 124/124 five times in a row; the one test 6/6
  with four busy CPU loops running. Not reproduced on CI itself.

## 2026-10-14 22:58 AEDT | decision | Gameplay rework planned: tennis rules, ready-up, Wii-style shots, training mode

- **Situation:** User wanted several changes: a ready step before multiplayer,
  proper tennis scoring, an unlimited mode, clearer forehand/backhand, a way to
  see where a shot will land, a how-to-play flow, easier camera control, and
  accounts. Discussed and planned only; no code changed.
- **Findings (from reading `pose.ts`, `camera/index.ts`, `sim.ts`):**
  - Camera setup's neutral capture only feeds point aim, and swing-level
    calibration duplicates thresholds already in shoulder-widths/second. Neither
    matters for classic swing with timing aim, so both leave the default flow.
  - Swing double-count: the classic detector ignores direction and has a 300 ms
    cooldown, so a wind-up plus forward swing can read as two. Not fixed now.
  - Level (light/medium/hard) sets speed, loft and height sensitivity, not aim.
    With `predictLanding` at hand-set contact heights, depth diverged by level
    off 1.0 m (hard: net at 0.5 m, long at 1.5 m). I overstated how much a
    player controls height; it comes from the incoming ball, and timing is the
    only input. Real contact heights are still to be measured.
  - I wrongly called the palm-to-camera grip unnatural; a backhand shows the back
    of the hand to the camera, which matches the code. The weakness is
    detection (0.3 threshold, previous grip kept on unclear reads).
- **Decisions:** classic swing and timing aim only (Wii Tennis feel); timing
  sets left-right, strength sets depth, height is automatic (`launch()` solves
  the arc); a wrong-side swing becomes a miss; a default auto-move mode with
  tilt kept as the alternative; grip is the single forehand/backhand signal
  (two signals that disagree feel worse); no lets; format chosen by the host
  before play, changing it clears ready flags; unlimited is unrated; guests get
  full scoring. Training mode is the camera's onboarding, with three arcs (the
  live one lit, the others greyed) and a timing meter.
- **Parked:** accounts and profiles, room codes (invite links already exist),
  quick-chat, and the double-swing fix.
- **Why:** each control now does one thing, so the landing aid can be honest
  and a new player can learn the mapping.
- **Output:** tasks 11-18 and the "Gameplay rework" section in
  `tasks/00-overview.md` (build order and which tasks can run as parallel
  agents). Open: three or two strength levels; target depths need playtesting.

## 2026-10-14 23:07 AEDT | milestone | Task 14: camera setup, grip and tilt reworked (no real-webcam playtest yet)

- **Situation:** Camera opening asked for a neutral capture and light/medium/hard
  swings; grip flickered; tilt was either too twitchy (9 degrees) or too much (16).
- **Change:** Default flow is now safety notice ("Got it", optional "don't show
  again" in localStorage inside try/catch), hand/mode/aim choice, then a
  "can we see you" check (shoulders, elbow and wrist required; hand shown).
  Neutral capture and swing levels moved behind a collapsed Advanced section.
  Defaults stay classic + timing. Grip is still the only forehand/backhand
  signal: `GripTracker` smooths the palm reading (alpha 0.4), threshold lowered
  0.3 to 0.15, locks during a swing, keeps the last grip on an unclear reading;
  a large FOREHAND/BACKHAND badge sits under the preview. Tilt: `AutoNeutral`
  takes the median of the first 1 s of tracking (no movement until then),
  `fullTilt` 16 to 11 degrees with a 1.4 power curve, and a gauge shows dead
  zone (3 degrees), edges and current lean.
- **Why:** Fewer steps before play; one clear grip rule; easier lean.
- **Guesses to playtest:** smoothing alpha 0.4, grip threshold 0.15, fullTilt 11,
  curve 1.4, 1 s auto-neutral window. None verified on a real webcam; the fake
  e2e webcam has no person in it.
- **Verification:** `pnpm check` 131/131, `pnpm e2e --workers=1` 26/26 (port 8091).
  New unit tests for smoothing, lock, unclear reading, auto-neutral, curve,
  visibility; e2e for the notice, "don't show again" and blocked storage.

## 2026-10-14 23:17 AEDT | decision | Shot rules: strength sets depth, height solved, wrong side is a miss (task 12)

- **Situation:** Depth depended on contact height (`loft + heightGain`), so a
  low ball hit hard went into the net and a high one long, though the player
  never controls height. A mismatched forehand/backhand was a weaker shot.
- **Measured first** (throwaway bot-vs-bot script, 200 seeds x 2 min, old
  code): medium returns are met at 0.84-1.11 m (median 0.91), serve returns at
  1.04-1.11 m. With every swing forced light, contact is 1.11-1.46 m; forced
  hard, 0.38-1.11 m (median 0.45) and 4871 of 5003 points end in the net.
  Old `predictLanding` at 0.5-1.5 m: medium depth drifts 3.7-8.1 m, hard is in
  the net at 0.6-0.8 m and out at 1.5 m.
- **Decision:** `STROKES` is `{ speed, depth }`; light 11 m/s to 4 m past the
  net, medium 14 m/s to 6 m, hard 18 m/s (backhand 16.5) to 8 m, all inside
  the 11 m half. `launch()` takes the flight time from speed and solves the
  upward speed for the tick integration (`moveBall`), lengthening the flight
  only if the ball would cross lower than net + 0.3 m. Sweep of 2250 cases
  (contact 0.1-2.6 m, anywhere in the hit window, all levels, kinds, aims):
  none in the net, none long; depth within 0.3 m of target. `MISMATCH` deleted;
  `missReason(s, seat, kind, hand)` returns `"wrong side"`, except within 0.3 m
  of the player's middle where either side works. Follow-mode lift now moves
  depth by up to 1 m. The client labels the miss "wrong side".
- **Why three levels, and why hard doesn't win everything:** with height gone,
  hard would be strictly best, so hard gets a wider aim spread (0.15 / 0.2 /
  0.26 per level). Over the whole timing window, timing-aimed shots go out 8%
  light, 15% medium, 29% hard; hard reaches the far baseline in 1.2 s against
  1.56 s medium and 1.98 s light. Three distinct trade-offs, so three levels.
  Bot-only rallies at forced hard still last (mean 15.7 shots), because the
  bot never aims at full width; only people take the risk.
- **Tests:** table test (0.5-1.5 m, every level, both kinds: clears the net,
  lands in, near its depth) failed 13 tests on the old sim (hard in the net or
  long; light/medium off depth) and passes now; wrong side for each kind and
  for a left hand; timing side mapping for every seat, hand and kind.
  `pnpm check` 132/132.
- **Open:** HUD showing the detected level (task 12), playtest of the depths,
  and task 14 must make the grip reliable now that a wrong grip is a miss.

## 2026-10-14 23:01 AEDT | milestone | Pure tennis scoring module (task 11, step 1)

- **Situation:** Task 11 needs real tennis scoring, but `sim.ts` is being
  changed by another session, so wiring it in now would conflict.
- **Outcome:** Added `shared/games/tennis/scoring.ts` (immutable `ScoreState`,
  `createScore`, `pointWon`, `fault`, `pointCalls`, `displayScore`) and
  `spec/scoring.test.ts` (32 table-driven tests: 0/15/30/40, deuce and
  advantage, games, sets, tiebreak serve order and win-by-2, oneSet and
  bestOfThree, serve alternation, double fault). Sim, protocol and client
  untouched.
- **Why:** A pure module with no I/O or randomness keeps the server
  authoritative and the logic testable. Wiring comes after the sim change lands.

## 2026-10-14 23:38 AEDT | bug | Playtest: backhand shows NO GRIP or swings repeatedly; distance, elbow and preview size

- **Situation:** First real-webcam playtest of task 14. User reported: the
  backhand sometimes reads as NO GRIP; a backhand keeps swinging; 1.5-2 m is too
  far; the setup asks for the elbow, which is uncomfortable; the camera preview
  looks small, as if cropped.
- **Cause (from the code):**
  - NO GRIP: `palmFacing` returned null unless the elbow was visible, and a
    close player's elbow is usually out of frame, so the badge fell to NO GRIP.
  - Repeated backhand swings: the classic detector ignored direction, so the
    wind-up (toward the off-hand side) and the recovery both counted as swings
    along with the real stroke. This is the double-count parked in task 18,
    now showing on the backhand, so the direction part is pulled forward.
  - Preview: the stream was requested at 640x480 (4:3), so many webcams crop a
    4:3 window out of a wide sensor, and the preview box was 240 px 4:3.
- **Fix:** grip falls back to the hand's own direction (wrist to the
  pinky/thumb midpoint) when the elbow isn't visible, and the setup check needs
  only shoulders and the racket wrist. A classic swing only fires when its
  sideways sweep matches the grip (forehand toward the off-hand side, backhand
  toward the racket side, at least 0.15 shoulder-widths). The stream is asked
  for 1280x720 and the preview is 16:9, 300 px wide. Safety text now says
  about 1 m.
- **Tests written:** grip reads with the elbow hidden; `swingMatchesGrip`
  table; a backhand wind-up then stroke gives exactly one shot (fails without
  the direction check, checked).
- **Open:** the 0.15 sweep and the elbow-free fallback are untested with a real
  webcam; the longer cooldown and the settle rule from task 18 are still
  parked. Whether a camera is really cropping needs checking on the user's
  device (the browser may still pick 4:3).

## 2026-10-15 00:15 AEDT | bug | Backhand still needed the elbow; camera view too narrow

- **Situation:** After the elbow fallback, the user said the backhand still
  needs their elbow to be seen, and that the webcam's width matters more than
  its height; asked for a better preview position and more width.
- **Cause (hypothesis, not confirmed on the user's camera):** a backhand takes
  the racket hand across the body and out to the side. At close range a narrow
  view cuts the arm off, and the pose model's confidence in the wrist and hand
  drops below the 0.5 cutoff that every landmark shared, so the hand was
  dropped along with the elbow. My earlier fallback only helped when the wrist
  and hand still cleared 0.5.
- **Fix:**
  - Wrist, thumb and pinky are trusted at 0.3 (shoulders stay at 0.5), a guess
    to playtest.
  - The stream asks for a 16:9 1280x720 view, and when the camera has a zoom
    control it is set to its widest (best effort; unsupported cameras keep
    their own view).
  - The preview, grip badge and lean gauge now sit in one dock whose height
    follows the real video, so the preview shows the whole frame, never a
    cropped one (it was a fixed 16:9 box with object-fit cover, which crops
    any other shape).
- **Test written:** a hand at 0.35-0.4 confidence still gives a wrist, a
  backhand grip and "seen" in the setup check; at 0.15 it is dropped. Fails at
  the old 0.5 cutoff (checked).
- **Open:** I can't tell from here what resolution or field of view the
  browser really gave the user's camera. Needs a real-webcam check, including
  whether a backhand now holds without the elbow in frame.

## 2026-10-15 00:23 AEDT | decision | Dropped the camera zoom-out

- **Situation:** The last change set the webcam's zoom to its minimum when the
  camera exposes one. User asked what happens if it zooms out a lot.
- **Outcome:** Removed it; the 16:9 request stays. A far zoom-out makes the
  player small, so the wrist and fingers get fewer pixels and the model tracks
  the hand worse; wide lenses also stretch the arm and skew the shoulder tilt;
  and on some cameras the setting can persist outside the game.
- **Why:** It couldn't be tested here, and the user's "seems better" can't be
  attributed to the zoom or to the 16:9 request. If the backhand gets worse
  after this, the zoom was helping and a capped version is the next try.

## 2026-10-15 00:24 AEDT | decision | Score bar and point announcement added to task 11

- **Situation:** User wants the score shown at the top of the screen, and a
  visible announcement when a point is scored.
- **Outcome:** Added a "Score display" section and a done-when item to
  tasks/11: a top score bar (points, games, sets, server) driven by the
  server's score state, with a short announcement and pulse on each point.
- **Why:** The server owns the score, so the bar only renders the snapshot.
  Reduced-motion and screen-reader behaviour are in the spec up front.

## 2026-10-15 00:27 AEDT | decision | Refreshed stale task statuses and merged tasks into four deliverables

- **Situation:** User asked about tasks 1-10. Their status lines were stale:
  01 said the README was a template (it is a 569-word draft), 10 said PROCESS.md
  was a template (crit 9 reflection is written, 594 words), 03 predated the
  playtest. 05's "not started" was right: grep finds no grace, forfeit or
  duplicate-token handling in the server.
- **Decision:** Grouped work into scoring and results (11 + 06), room lifecycle
  (05 + 13), aim aids and training (16 + 17) and crit docs (01 + 10, with 07 as
  a standing rule). Files are kept; the overview has the new table.
- **Why:** Each pair edits the same code or the same document, so one branch
  avoids the sim.ts-style conflicts seen on the first merge.

## 2026-10-15 00:27 AEDT | decision | Process evidence (task 10) is the user's own, not a deliverable

- **Situation:** I had grouped 01 + 10 as a "crit docs" deliverable for an agent.
- **Outcome:** User said process evidence is theirs. Removed it from the
  deliverables; agents leave `PROCESS.md` and the reflections alone and only
  append devlog entries. README (01) stays a deliverable.
- **Why:** The process mark rests on the user's own account of how they worked.

## 2026-10-15 00:31 AEDT | decision | Renumbered tasks into one flat build-order list

- **Situation:** Task numbers had stacked up (original 01-10, new 11-18, then
  "deliverables" like 11 + half of 06), which the user found confusing.
- **Outcome:** `tasks/` now has one list, numbered 1-11 in build order, for
  open work only: scoring in the game, auto-move, trajectory aid, room rules +
  ready-up + formats (the old 05 and 13 merged), training mode, stroke
  animation, leaderboard, stats, menu and accessibility, README, ship. Finished
  work is in `tasks/done/`, unnumbered; parked work and the user's own process
  evidence are unnumbered files. The overview has an old-to-new table, because
  this log and the done/ files still use the old numbers (the log is
  append-only, so it is not rewritten).
- **Why:** One numbering, with "waits on" per task, is easier to plan from than
  groups of groups. Files were moved with git mv to keep their history.

## 2026-10-15 00:36 AEDT | decision | Third arrival stays a spectator; winner-stays-on parked

- **Situation:** Deciding the multi-user rules for task 4. User likes the
  "winner stays on" idea but wants it later.
- **Outcome:** A third person is a spectator, as today, with no queue. Winner
  stays on is in parked.md. Still open for task 4: disconnect grace, second tab
  with the same token, and whether open rooms are listed.
- **Why:** The queue needs the ready-up room state machine first; spectating
  already works and is tested.

## 2026-10-15 00:37 AEDT | decision | Two tabs, one player is allowed (for testing)

- **Situation:** Task 4 asked what happens when the same token opens a second
  tab. User wants two tabs able to join one room for testing, flagged for later.
- **Outcome:** Allowed. Checked the code: `join()` in server/rooms.ts has no
  token comparison, and the client keeps its token in localStorage, so two tabs
  of one browser share it; demo accounts (demo-1, demo-2) give two identities.
  Added to tasks/04 as decided, with a spec test requested so it isn't removed
  by accident, and flagged in parked.md: ratings should ignore a match whose
  two seats share a token, and reconnect needs a rule for which tab wins.
- **Why:** Cheapest option, matches current behaviour, and the user needs it
  while testing alone.

## 2026-10-15 00:40 AEDT | decision | Disconnect and open-room rules for task 4

- **Decision:** On a mid-match disconnect the seat is held and the match pauses
  for 30 s; the same token reclaims it and the match resumes, else the room
  closes. No forfeit, no bot takeover. Rooms are reached by invite link or room
  code only, with no public list.
- **Why:** Smallest behaviour that is fair to both players and keeps strangers
  out. Forfeit and bot takeover were the costlier alternatives.
- **Left for task 4:** identity (pseudonym per token, renaming), and which tab
  reclaims a seat when one token has two tabs.

## 2026-10-15 01:23 AEDT | milestone | Real tennis scoring in the game (task 1)

- **Situation:** The scoring module was built and unit-tested but the sim
  still played first to 5 points, and the HUD showed "You 2 – 1 Bot".
- **Outcome:** The sim keeps a `ScoreState` in the snapshot: the server serves
  from `score.server`, a serve the receiver never touched that goes in the net,
  out or on the server's side is a fault (second serve, then double fault), a
  rally end calls `pointWon`, and `score.winner` ends the match. One set by
  default, best of three via an optional `format` on create (no chooser yet,
  task 4). Practice starts a new match instead of ending. `matches` moved to
  schema v2 (version table, migration step, test that opens a v1 database):
  sets won, games per set, format, practice and a `rated` flag. A two-row
  score bar replaces the old score text and announces each call for 2 s.
- **Why:** Rewind used "points changed" to refuse crossing a point, but a
  fault doesn't change points, so the sim now counts ended serves (`rally`)
  and rewind checks that. Practice-vs-bot is stored but never rated, so a
  rating can't be farmed off the bot. The bar first had a third row for the
  format and call; on a phone that pushed the HUD 9 px into the camera
  preview's spot, so those moved into a right-hand column.

## 2026-10-15 01:19 AEDT | milestone | Trajectory aid (task 3): three timing arcs, timing meter, strength readout

- **Situation:** Aiming by timing (the camera default) showed one straight
  arc, so players couldn't see that early goes cross-court and late down the
  line. The detected strength was never shown (left open in shot rules).
- **Outcome:** With the camera aiming by timing, three arcs (early, on time,
  late) show on the opponent's court; the arc for the ball's current third of
  the hit window is lit, the others grey. A meter along the bottom (early | on
  time | late) has a marker that moves with the ball. The lit arc carries
  light/medium/hard depth ticks: the last swing's level is picked, and during
  a classic camera swing a marker slides with the peak wrist speed so far.
  After your hit the real arc replaces them until it lands. "Detected: hard"
  (camera) or "Chosen: hard" (keys/buttons) sits beside the meter. An "Aid"
  button switches it all off (remembered); the reticle and game don't depend
  on it. Pure logic in `client/games/tennis/trajectory-aid.ts` with 19 unit
  tests, drawing in `aid.ts`/`aid-fx.ts`/`aid.css`; `e2e/aid.e2e.ts` at both
  viewports. No change to `sim.ts`, the protocol or the HUD.
- **Why:** Each arc is a copy of the shared sim stepped to that moment and hit
  with the same timing-aimed swing the server resolves, not a separate
  formula, so the test can compare it with a real hit for every seat, hand
  and kind. Turning off timing aim in the arc helper fails 11 of the tests.
  The arcs are worked out once per incoming shot, not per frame. The keyboard
  depth ticks first ran three `predictLanding` calls every frame and the
  frame-rate-sensitive trail e2e failed 2 of 3 runs on desktop (with another
  agent's browsers also running); computed only for an incoming ball and
  cached, it passed 6 of 6.

## 2026-10-15 01:22 AEDT | milestone | Forehand and backhand get their own arcs and a shot label (task 6)

- **Situation:** User said the backhand doesn't read on screen. In
  `character.ts` it was the forehand's sweep run backwards: same arm height,
  same racket face, straight arm, a mirrored body turn. The opponent's and
  bot's strokes started at 45% of the swing, where both arcs point the arm
  straight ahead, so a viewer saw nearly the same thing for either.
- **Outcome:** `client/games/tennis/stroke.ts` keyframes each stroke (wind-up,
  contact, finish) for arm, elbow, wrist, racket face, shoulder turn and off
  arm. Forehand: back low on the racket side, finish high over the other
  shoulder. Backhand: back by the far hip with the face turned over, finish out
  on the racket side with the off arm flung back. Measured on the rig, contact
  is +0.63 m vs -0.51 m from the player's middle. A `.shot-label` shows FOREHAND
  (yellow) or BACKHAND (blue) on every stroke, both seats and the bot, in the
  side stands on desktop and bottom left on a phone. A wrong-side miss turns it
  red, strikes the stroke through and says which side the ball was on. The
  pop-in and shake are off under reduced motion. Tests: `spec/stroke.test.ts`
  (rig measurements, label text), `e2e/stroke.e2e.ts` (both viewports: arcs
  projected through the game camera, label clear of the court's corners, the
  controls and `.cam-dock`, reduced motion).
- **Why:** A measured difference can't quietly go back to "only the side
  changes". The label sits beside the court rather than on it, because the
  score bar (task 1) takes the top and the timing meter (task 3) the bottom.
  The layout e2e "invite link" frame-count check fails on and off on this
  branch and on a clean build of main alike while other agents' browsers keep
  the load average at 15-22; it isn't caused by this change.

## 2026-10-15 02:19 AEDT | decision | Playtest: out balls and a short timing window queued as task 12

- **Situation:** User reported getting the point on a ball they hit out, the bot
  returning a ball and the user still getting the point, and the early / on
  time / late window going by too quickly.
- **Findings (probes against the real sim and bot, no code changed):** the bot
  volleys balls that are going out; a swing is accepted for about 5 ticks
  (80 ms) after an out ball lands, which cancels the pending out point; the
  hit window is 0.22 s either side of the baseline, so each third is about
  0.15 s. The dev server log doesn't record who hit last, so a specific rally
  couldn't be matched; the user's case is not confirmed to be either.
- **Also found:** strength sets flight speed (22 m / ball speed gives 1.98,
  1.57 and 1.22 s to the far baseline for light, medium and hard); depth only
  decides where it bounces and how high it arrives. With full-speed auto-move
  nothing beats the opponent, so auto-move is being made slower (about 60% of
  5 m/s, to be tuned by measurement) and the agent was told.
- **Decision:** queued as tasks/12-rally-fixes.md, to start after task 2 lands,
  because auto-move changes who can reach what in the same rallies.
- **Also noted:** the Vite dev server has the same stale-file problem on /mnt/c
  as node --watch; after any merge restart both dev processes.

## 2026-10-15 02:46 AEDT | milestone | Auto-move (task 2): the server walks you to the ball, slower than you can run

- **Situation:** With the camera, moving meant leaning while also timing a
  swing, which is two skills at once. Task 2: a movement mode, the default,
  where the server moves you and you only swing. Lean stays as the other mode.
- **Outcome:** Each seat has a mode, `auto` or `tilt`, sent as
  `{ t: "mode" }` (anything else is a bad message) and fed to the sim as an
  input, so it stays in the input stream and rewind replays it. In auto
  `autoTargetX` aims 0.6 m (`AUTO_OFFSET`) short of the predicted contact, on
  the side the ball is heading to, so it comes on a clear forehand or backhand
  side (past `EITHER_SIDE`, inside reach). The wrong kind still misses. The
  bot moves by the same rule. Auto walks at `AUTO_SPEED` = 0.7 x 5 m/s.
  Measured from the far sideline on in-landing shots, full aim is reached
  100% light, 50% medium, 0% hard; straight shots 100% at every level.
  Bot-vs-bot mean rally is 3.91 (3.92 before). Camera: "Move: auto / Move:
  lean" under the preview, remembered in localStorage; in auto no lean
  targets are sent and the lean gauge is dimmed. Tests:
  `spec/auto-move.test.ts` (5 sim mutations each caught),
  `spec/rooms.test.ts` "movement mode" (all 3 fail on the old server),
  `e2e/auto-move.e2e.ts` at both viewports.
- **Why:** The user decided auto must be slower than manual movement. At full
  speed it reached 100/100/33% of full-aim shots, so strength would stop
  mattering. 0.6 (80/25/0) was closer to "light almost never beats it" but
  cut the bot's rallies to 3.76; 0.7 keeps them in the old band and gives
  medium a true 50/50. Keyboard/touch: every seat starts in auto, and a move
  key takes over at full speed until the next ball comes at you. Keyboard
  players get the help by default and can still go anywhere, and no
  keyboard-only toggle is needed. The user may overrule this.

## 2026-10-15 03:28 AEDT | bug | Out ball volleyed by the bot is not called out

- **Situation:** User: when the trajectory pointed out and they hit that swing,
  the ball went out, but the bot still hit it and the point wasn't counted as
  out. This matches the earlier probe: the bot swings at a ball in the air
  before it lands (a legal volley in the sim), and an out call only happens
  when the ball lands, so a volley skips it.
- **Decision:** a shot that will land out is dead from the moment it is hit,
  not only after it lands: the receiver can't hit it, the bot doesn't try, and
  the point is called when it lands. Written into tasks/12. This changes the
  rules for people too (no volleying a ball that is going out), which is what
  the user described wanting.
- **Why:** The out call should follow the shot, not whether the receiver
  happened to swing. Deciding at launch is deterministic and keeps rewind
  (ADR 001) safe because the ball's own history decides.

## 2026-10-15 03:34 AEDT | decision | Correction: a ball going out can be hit or left (not dead from launch)

- **Situation:** I had written "a shot that will land out is dead from the
  moment it is hit" into task 12 and told the user it was what they described.
  The user replied that they want to be able to hit something going out, or
  choose not to. My rule was an overreach on their report, which was about the
  bot hitting an out ball and it not being counted as out.
- **Decision:** the ball stays live in the air, for people and the bot alike.
  The bot decides not to swing at a ball it predicts will land out; a person may
  hit it or leave it, and if left it is out when it lands (their point). A ball
  that has landed out is dead, which closes the 80 ms window after the bounce.
- **Why:** it matches real tennis, keeps the choice with the player, and still
  fixes both reports: the bot no longer rescues out balls, and a swing can't
  cancel an out call after the bounce. Written into tasks/12; the agent building
  it was told to drop the dead-from-launch design.

## 2026-10-15 04:01 AEDT | decision | Wii-style home screen requested (task 13)

- **Situation:** User asked for a new home screen inspired by Wii Sports /
  Resort: "Weblympics" title, a thumbnail below it, sport buttons below that,
  on theme, listing every sport (only Tennis exists). Reference:
  design/reference/WiiSports-Menu.webp (300x237).
- **Decision:** Built as task 13, written to tasks/13-home-screen.md and given to
  an Opus agent. Took the look (pale sky-blue background, glossy pill buttons, a
  framed preview that follows the focused sport, a pointer marker) but not the
  reference's layout, since the user specified title, thumbnail, buttons. No
  Nintendo assets or text; all CSS/SVG, no Three.js on the menu. Tennis stays
  the only playable sport (CLAUDE.md); disabled "coming soon" buttons for other
  sports are optional and flagged for the user.
- **Why:** The menu is the first thing a player sees, and a list-driven sport
  menu makes adding a second game one entry once the core is solid.

## 2026-10-15 04:01 AEDT | bug | Dev server shows old code on this drive; cause not yet found

- **Situation:** After merges the user twice saw the old client (a score line
  reading "undefined – undefined", then no auto-move toggle) on the dev server.
- **Findings:** (1) `node --watch` and Vite's file watcher both miss edits on
  /mnt/c, so after a merge or branch switch both need a manual restart; the first
  stale view was Vite serving a cached view.ts, fixed by restarting it. (2) Port
  8080 serves the built bundle in dist/client, which was last built at
  00:15 on 15 Oct, so it stays old until `pnpm build`; 5173 is the one to use.
  (3) On the second report I confirmed from WSL and from Windows (PowerShell) that
  127.0.0.1:5173 and localhost:5173 both serve the new files, that
  wslrelay.exe is the Windows-side listener (expected), that there is no service
  worker, and that Vite sends Cache-Control: no-cache; only [::1] fails.
- **Status:** UNRESOLVED. A headless browser sees the new page, the user's
  browser still reportedly does not. Next: which browser, and does 127.0.0.1
  differ from localhost, a private window, hard refresh.
- **Why this matters:** a "fixed" feature that the user can't see wastes
  playtests. Worth a one-command restart script and a rule in CLAUDE.md.

## 2026-10-15 04:01 AEDT | milestone | Merge verification for tasks 1, 3, 6 and 2

- **Situation:** Four agent branches merged into main by me, each on a fresh
  integration branch with a clean build.
- **Outcome:** Tasks 1, 3 and 6 merged at c0d726b: pnpm check 227/227, pnpm e2e
  --workers=1 48/48. Task 2 merged at 47d2d7e: check 243/243, e2e 54/54. Both
  verified by me, not only by the agents' own reports.
- **Problems the merge caught:** task 1 changed createState's second argument
  from a score limit to an options object, so task 3's tests (written against
  the old signature) failed typecheck only on the merged tree; fixed by passing
  { endless: true }. Task 1's first e2e run failed the trail test under machine
  load (load average 10-13) and passed 3 of 3 alone and in the full run on a
  quiet machine, so it was load, not the code; that test is timing-sensitive
  and is on the test-gaps list.
- **Why:** Each branch was green alone; only the merged tree shows cross-branch
  breaks.

## 2026-10-15 04:01 AEDT | decision | Reaction time comes from ball speed, not depth

- **Situation:** User asked whether the speed and depth a ball is delivered at
  change the reaction time they have, in light of auto-move.
- **Measured (real sim, hit from the baseline):** flight to the far baseline is
  1.98 s light (11 m/s), 1.57 s medium (14 m/s), 1.22 s hard (18 m/s): about
  22 m / forward speed. The ball keeps 100% of its forward speed after the
  bounce and contact height doesn't change the time, so depth (4, 6, 8.2 m) only
  decides where it bounces. My first "sideways run" figure for hard was wrong
  (a full-aim hard shot lands out, so the probe stopped early); light needs
  about 1.7 m/s and medium 2.8 m/s of sideways running.
- **Decision:** auto-move was made slower than manual (the agent measured
  AUTO_SPEED options and chose 0.7, 3.5 m/s; manual stays 5 m/s) so hard wide
  shots still beat it. Making depth affect time would need a post-bounce speed
  change; not done, speed already does the job.
- **Why:** with full-speed auto-move nothing could beat the opponent, so strength
  would have stopped mattering.

## 2026-10-15 04:01 AEDT | event | Which model each agent ran on

- **Situation:** User asked whether the agents ran on Opus 5.5.
- **Outcome:** Read from each agent's transcript (the model field of every
  request). First wave: scoring module and camera setup ran on claude-sonnet-5-5;
  shot rules on claude-opus-5-5. Everything launched since (tasks 1, 3, 6, 2,
  12, 13) is claude-opus-5-5 via the `opus` alias. The main session itself
  (this log, merges, task files) is Sonnet 5.5.
- **Why:** The user wanted Opus for the building; recording it so the process
  evidence doesn't have to guess.

## 2026-10-15 04:03 AEDT | decision | Devlog rule: log as it happens, and say who decided

- **Decided by:** user (asked for the rule and for the user/Claude split to be
  visible); wording by Claude.
- **Situation:** The user checked whether things were being logged. Several
  decisions, the merge checks and the dev-server problem had not been written
  up until asked, and the log didn't say who made each call.
- **Outcome:** CLAUDE.md's Docs section now requires entries when things
  happen, entries for playtest findings, merges (with the checks run) and
  unresolved problems, and a Decided by line (user, Claude or agent). Tuning
  numbers count as Claude or agent guesses until the user playtests them, and
  any visible choice by Claude or an agent is told to the user at the time.
  Older entries have no Decided by line; the log is append-only, so they are
  not rewritten.
- **Why:** The process mark rests on an honest account of who decided what, and
  the user needs to know which choices are theirs to overrule.
