# Handoff: where things stand (2026-10-16)

For picking up in a new session. Read `CLAUDE.md` and `tasks/00-overview.md`
first; this file is the short list of what is open and what to check. Nothing
here is committed work in progress: `main` is clean at `7ca524c` (plus whatever
commits this note adds), all checks were green (`pnpm check` 368/368,
`pnpm e2e --workers=1` 90/90).

## Not pushed
- **74 commits are ahead of origin.** CLAUDE.md says to ask before any push
  (pushing to main deploys once the repo is public). Task 11 (ship) is where
  this happens: push, make the repo public, CI green, tag.

## Needs the user's eyes (nothing here is seen on a real webcam yet)
- **Stance label, red state.** The pill above the timing meter turns red when the
  held grip is wrong for the ball's side. Its logic is tested against the sim's
  own rule, but the fake webcam has no person, so the red state was never seen.
- **Lean in the training movement drill.** The camera control is switched to lean
  while the drill runs and back to auto after; untested on a real camera.
- **Camera setup values are guesses**: grip smoothing 0.4 and threshold 0.15, tilt
  full at 11 degrees with a 1.4 curve, hand confidence cutoff 0.3. Playtest notes
  belong in `logs/devlog.md`.
- **Auto-move speed 0.7 and the stop-short offset 0.6 m** were chosen by an agent.
- **Task 4 room choices** the agent made (names are server-made and can't be
  changed; Leave mid-match ends it with no result; rematch returns to the ready
  check; wording of the ready panel). Listed in the devlog entry
  "Merged task 4"; none confirmed.
- **Task 5 training choices** the agent made (note wording, step titles, 1.4 s
  auto-advance, target rings, button names). Listed in the devlog entry "Merged
  task 5"; none confirmed.
- **Two real sessions on one account the next day** (task 4's unchecked box).

## To discuss (parked in `tasks/parked.md`)
- **Per-stroke calibration of light, medium and hard** (forehand and backhand).
  Questions are written there.
- Accounts and profiles, room codes, winner-stays-on, the swing double-count fix.

## Open question from the last playtest
The user played practice against the bot and lost 0-5 in games (the bot won 20 of
22 points; the user made 52 swings, 48 hits and 4 wrong-side misses). They
reported the bot's row going "0 0 40" to "0 2 40". Checked: **not a score bug**.
Replaying the 22 logged points through `scoring.ts` gives legal single points
each time, and 60 simulated matches had 0 illegal jumps in 719 score changes;
the two readings were eight points apart. What is NOT known: whether the bot is
too strong, or the user's shots are weak. If it matters, measure bot win rate
against a typical swinger, where the user's landings end up, and consider a
softer bot (the bot lives in `shared/games/tennis/bot.ts`, plus its let-go rule
from task 12).

## Queued tasks (see the overview table)
- **14 Colours and logo**, **15 Game pages, recorded thumbnail, webcam default**
  (15 also wires training as the step after camera setup), **16 Point banner and
  reaction effects**.
- **7 Leaderboard and ratings** and **8 Stats and logging**: held at the user's
  request. 7 must read only `rated = 1` rows (a test enforces it).
- **9 Menu and accessibility**, **10 README** (588 to 599 words, near the 600
  limit; check the count after any edit), **11 Ship**.
- Process evidence (`tasks/yours-process-evidence.md`, PROCESS.md and the
  reflections) is the user's own; agents don't edit it.

## Test gaps nobody has written up as a task
- Real-person camera traces (record landmarks from the user's own swings, replay
  them in tests: forehand, backhand, a lean, standing still).
- Hostile client messages against the new `ready`, `format` and `mode` inputs.
- An accessibility scan (axe) in the e2e, reduced motion, keyboard-only play.
- Timing-based e2e tests: two flaked this week (the swing-tick test and the long
  training walk-through). Both were test races, not game bugs, and are fixed.

## Things to know before you start
- **Restart both dev processes after any merge or branch switch.** `node --watch`
  and Vite both miss edits on this `/mnt/c` drive and serve old files. Use
  `http://localhost:5173` for development; 8080 serves the last `pnpm build`.
- **Don't kill dev processes by name pattern.** It has taken the shell down; find
  the PID from the port (`ss -ltnp | grep :8080`) instead. Run tests on a spare
  port with `PORT=81xx DATA_DIR=$(mktemp -d)` and `APP_URL=...`; never 8080 or 5173.
- **The full e2e takes about 10 to 12 minutes**, so run it in the background and
  wait for it; frame-rate tests flake when other browsers are running.
- **Don't use `git stash` in the shared checkout** (the stash is shared across
  worktrees).
- **Which model ran what** is in the devlog (agents: Sonnet for the first
  scoring and camera work, Opus 5.5 for everything since). Verify a model from
  an agent's transcript, not from the alias.
- **Cleanup that is safe to do:** 18 leftover agent worktrees and branches
  (`.claude/worktrees/agent-*`, `integrate`, `integrate2` to `integrate4`) are all
  merged or abandoned. Remove with `git worktree remove` and `git branch -d`
  after checking nothing in them is wanted. The two stopped agents' early
  worktrees (`af2af8b…`, `af560b6…`) hold no commits.
- **Backups:** `/tmp/app.db.before-schema2` and `/tmp/app.db.before-schema3` are
  copies of the dev database from before each migration (in `/tmp`, so they go
  when the machine restarts). The dev database is now schema version 3.
- **Docs worth reading:** `docs/reaction-time.md` (measured reaction times and
  movement, with a method note about a bad probe), `docs/adr/001-who-wins-under-lag.md`,
  and the devlog from 2026-10-14 22:58 onward for every decision and who made it.
