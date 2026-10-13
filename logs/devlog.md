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
