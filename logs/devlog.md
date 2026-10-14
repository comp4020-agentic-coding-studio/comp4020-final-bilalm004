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
