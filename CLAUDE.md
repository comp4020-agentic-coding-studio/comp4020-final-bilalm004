# Weblympics

Wii-Tennis-style game in the browser. Two players (or one vs a bot) hit a shared
ball by swinging in front of their webcam; spectators watch live. The server
owns the ball and the score. Clients only send swing events and render what the
server says. Rooms, matches and ratings persist in SQLite on `/data`.

Brief: https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/
Fixed by the course: `fly.toml`, `Dockerfile` shape, `spec/invariants.test.ts`
(`/` returns 200, `/readme/` publishes `README.md`). Never delete those checks.

## Stack

TypeScript everywhere, pnpm, Node 24. Server: plain `node:http` + `ws` +
`node:sqlite`. Client: Vite + vanilla TS + Three.js, low-poly flat-shaded 3D (no
post-processing, no heavy assets). Camera swing detection is MediaPipe, loaded
lazily and only when a player enters a game. Video never leaves the browser.

## Layout (update this when it changes)

- `shared/` pure, deterministic game sim and the WebSocket protocol, used by
  server and client. Each game lives in `shared/games/<name>/` (sim, bot,
  adapter) and registers in `shared/games/registry.ts`. Tennis scoring
  (points, games, sets, tiebreak, faults) is `shared/games/tennis/scoring.ts`;
  the sim keeps its `ScoreState` in the snapshot. `machine.ts` is training's
  seeded ball machine (feeds with the sim's own `launch()`). Archery
  (task 22) is `shared/games/archery/`: `sim.ts` (stages, seeded wind,
  flight, rings; `predictHit` with no wind is the client's preview),
  `bot.ts` (`solveAim` plus noise), `index.ts` (adapter).
- `server/` `index.ts` (http + ws + `/readme/`), `rooms.ts` (live rooms with
  the real clock and db), `room.ts` (one room: 60 Hz tick loop, seats,
  spectators, game), `lobby.ts` (pure room rules: phases, ready, format,
  countdown, the 30 s hold; clock injected), `db.ts` (SQLite on `/data`), `schema.ts` (versioned
  schema, migrations, match rows, who is rated), `log.ts` (JSON log lines).
  Rooms get their sim from the registry, so networking is game-agnostic.
- `client/` Vite app: `games/<name>/view.ts` (scene, HUD, input wiring),
  `games/tennis/score-bar.ts` (top score bar and the umpire's call),
  `games/tennis/ready-panel.ts` + `.css` (the room's ready panel, task 4),
  training (task 5): `training.ts` + `.css` (coach panel, landing mark),
  `lessons.ts` (pure: steps, feedback words, "Why?" notes),
  `training-sim.ts` (sim + ball machine in the page) and `local-link.ts`
  (a `GameLink` like `Connection`, so `view.ts` renders training unchanged;
  no network),
  `games/tennis/stadium.ts` (arena from primitives, instanced crowd/trees),
  `games/tennis/character.ts` (Mii-style player and racket),
  `games/tennis/stroke.ts` (forehand/backhand keyframes, shot label text),
  `games/tennis/shot-fx.ts` (ball trail, bounce marks, shot arc),
  `games/tennis/trajectory-aid.ts` (pure: timing arcs, meter, strength ticks)
  with `aid.ts`/`aid-fx.ts`/`aid.css` drawing it (task 3), `input/`
  (`keyboard.ts` for keys, pointer and buttons; `camera/` with `pose.ts` pure
  landmark maths, `camera.ts` webcam + lazy MediaPipe, `index.ts` setup
  panel), `net/socket.ts` (`Connection`), `net/link.ts` (`GameLink`), `ui/menu.ts` (home screen: title, framed sport preview,
  sport buttons from the `SPORTS` list; inline SVG/CSS only, no Three.js). Camera swings have two modes,
  "classic" (default) and "follow" (character copies the arm, hit at the
  hitting line), and two aim modes, "timing" (default) and "point"; see
  the camera setup notes in `tasks/done/`. Movement has two modes per seat,
  "auto" (default: the server walks you to the ball, `autoTargetX` in
  `sim.ts`) and "tilt" (lean to move); keys and buttons move you in either
  (task 2).
- `spec/*.test.ts` vitest against the running app, plus the sim unit tests.
- `e2e/*.e2e.ts` Playwright at both viewports, fake webcam.

## Commands

- `pnpm build && pnpm start` runs the app on :8080 (`DATA_DIR` overrides
  `./data`). `pnpm check` (typecheck + spec) and `pnpm e2e` need it running.
- `pnpm dev:server` + `pnpm dev:client` for hot reload (vite proxies to :8080).
  On this `/mnt/c` drive `node --watch` misses edits: restart `dev:server`
  before `pnpm check`, or the spec runs against the old server.
- Docker isn't available in this WSL; CI builds the image, so keep the
  Dockerfile's runtime stage free of dev dependencies.

## Docs

- `tasks/` is the work breakdown (start at `00-overview.md`, one numbered list in build order); update a task's
  status line when it changes.
- `README.md` 400-600 words on what "good" means here (served at `/readme/`).
  `PROCESS.md` 900-1100 words, rewritten each crit.
- `logs/devlog.md` is append-only. Log decisions, milestones, bugs and playtest
  findings: date/time (from `date`), type, what happened, outcome, why, and who
  decided it (`user`, `Claude` or `agent`).

## Rules

- The server never trusts a client's claim of a hit or a score; it resolves
  hits from swing timestamps against its own sim.
- Scoring is real tennis for everyone (`spec/sim-scoring.test.ts`): one set by
  default, best of three or unlimited, tiebreak at 6-6, two serves per point, no lets.
  The score bar only renders the server's `ScoreState`. Practice never ends
  (a won match starts a new one) and practice-vs-bot is never rated
  (`spec/db.test.ts`).
- Rooms (task 4; `spec/lobby.test.ts`, `spec/room-rules.test.ts`,
  `spec/rooms.test.ts`): invite link or room code only, no public list. Two
  seats; a third arrival only spectates (no queue). Phases `waiting ->
  ready-check -> countdown (3 s) -> playing`; each seat's `ready` is the
  server's, the bot is always ready, un-readying cancels the countdown, a
  disconnect before the match frees the seat. The host (first seat) picks one
  set (default), best of three or unlimited before play; a change clears both
  ready flags. Mid-match, a dropped connection holds the seat and pauses for
  30 s ("waiting for <name>", seconds left); the same token reclaims it and a
  3 s countdown resumes play, otherwise the room closes with no result.
  Pressing Leave mid-match ends it with no result. Unlimited has no winner,
  counts points and best rally, ends when someone leaves and is stored
  unrated. Practice vs bot starts at once. One token may hold both seats (two
  tabs, for testing); its second seat is shown "<name> (2)" and its matches
  are unrated. Names are server-made pseudonyms, not renameable. Ratings read
  only `rated = 1` rows.
- A schema change is a new step in `server/schema.ts` plus a test that opens
  a database made by the previous version; never edit an old step.
- A ball in the air is live for everyone, even one going out: a person may
  volley it or leave it. Once it has landed out (or bounced twice) it is dead
  and every swing misses. The bot lets go a ball it predicts will land out
  (`spec/rally-fixes.test.ts`, task 12).
- Game logic stays deterministic (seed + input stream) so it can be tested.
- Tennis and archery (task 22) are the playable games. Add another only when
  I ask. Each lives in `shared/games/<name>/` and registers in the registry, so
  rooms, lobby and reconnect stay game-agnostic. A game's specs are named
  `spec/<name>-*.test.ts` and `e2e/<name>-*.e2e.ts`.
- Video never leaves the browser. The game page's CSP `connect-src` allows
  only this server and the pose model's download hosts (`spec/privacy.test.ts`);
  it also blocks MediaPipe's own usage pings. Don't widen it casually.
- Training (task 5) runs in the page: no room, score or rating, and nothing
  sent to the server (`spec/training.test.ts`, `e2e/training.e2e.ts`).
  Required steps: swing, forehand, backhand, timing (early, on time and late
  each landing in), strength; auto-move stays on. Moving yourself is offered
  after them and optional. Figures in its notes come from `docs/reaction-time.md`.
- Camera is used for gameplay only. Every camera action has a keyboard/mouse
  equivalent, and the lobby and room work with no camera at all.
- Auto-move (`spec/auto-move.test.ts`) walks slower than manual movement
  (`AUTO_SPEED` share of `PLAYER.speed`) so a wide hard shot can beat it;
  strength must keep mattering. The movement mode is an input to the sim,
  never a client claim of position.
- Every bug fix adds a test that fails without it. When I correct you, put the
  rule here or in `spec/`, not only in the chat.
- Keep `README.md`, this file and `spec/` consistent; a claim in one needs to
  hold in the others.

## Viewports

Everything must work at desktop 1920x1080 and mobile 390x844: no horizontal
scroll, controls reachable, canvas not clipped. Check both for any UI change.

## Workflow

- Small changes (copy, styling tweaks, comments, renames): don't run tests.
- Changes confined to one game (`shared/games/<name>/`, `client/games/<name>/`,
  its specs): run only that game's specs (`pnpm vitest run spec/<name>`) and
  e2e (`pnpm e2e --workers=1 e2e/<name>`). Anything touching shared code
  falls under the next rule.
- Changes to `shared/`, `server/`, the protocol, the db or `spec/`: run
  `pnpm check` without being asked.
- UI or layout changes: run `pnpm e2e` (both viewports) without being asked.
  Use `pnpm e2e --workers=1` here: in parallel, several software-rendered
  1080p browsers starve the frame rate, and the trail and camera tests fail
  on code that passes one at a time.
- Never commit or push on red. Commit when green, in small commits with clear
  messages. Gate on the test command's own exit code, never on a
  pipe into `grep` (the pipe's status is grep's, so red can look green).
- When another session is editing the tree, stage files by name and check
  the commit against a clean build of HEAD (a `git worktree` on another
  port), since the shared working tree also builds in their unfinished work. Ask before every push (pushing to main deploys once the repo is public).
- Never commit secrets or `mise.local.toml`.
