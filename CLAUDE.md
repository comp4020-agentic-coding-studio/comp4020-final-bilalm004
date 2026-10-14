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
  the sim keeps its `ScoreState` in the snapshot.
- `server/` `index.ts` (http + ws + `/readme/`), `rooms.ts` (60 Hz tick loop,
  seats, spectators), `db.ts` (SQLite on `/data`), `schema.ts` (versioned
  schema, migrations, match rows, who is rated), `log.ts` (JSON log lines).
  Rooms get their sim from the registry, so networking is game-agnostic.
- `client/` Vite app: `games/<name>/view.ts` (scene, HUD, input wiring),
  `games/tennis/score-bar.ts` (top score bar and the umpire's call),
  `games/tennis/stadium.ts` (arena from primitives, instanced crowd/trees),
  `games/tennis/character.ts` (Mii-style player and racket),
  `games/tennis/stroke.ts` (forehand/backhand keyframes, shot label text),
  `games/tennis/shot-fx.ts` (ball trail, bounce marks, shot arc),
  `games/tennis/trajectory-aid.ts` (pure: timing arcs, meter, strength ticks)
  with `aid.ts`/`aid-fx.ts`/`aid.css` drawing it (task 3), `input/`
  (`keyboard.ts` for keys, pointer and buttons; `camera/` with `pose.ts` pure
  landmark maths, `camera.ts` webcam + lazy MediaPipe, `index.ts` setup
  panel), `net/socket.ts`, `ui/menu.ts`. Camera swings have two modes,
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
- `logs/devlog.md` is append-only. When a design decision, milestone, notable
  bug or config change happens, add an entry (date/time from `date`, type,
  situation, outcome, why) in the format of the existing entries.

## Rules

- The server never trusts a client's claim of a hit or a score; it resolves
  hits from swing timestamps against its own sim.
- Scoring is real tennis for everyone (`spec/sim-scoring.test.ts`): one set by
  default or best of three, tiebreak at 6-6, two serves per point, no lets.
  The score bar only renders the server's `ScoreState`. Practice never ends
  (a won match starts a new one) and practice-vs-bot is never rated
  (`spec/db.test.ts`).
- A schema change is a new step in `server/schema.ts` plus a test that opens
  a database made by the previous version; never edit an old step.
- A ball in the air is live for everyone, even one going out: a person may
  volley it or leave it. Once it has landed out (or bounced twice) it is dead
  and every swing misses. The bot lets go a ball it predicts will land out
  (`spec/rally-fixes.test.ts`, task 12).
- Game logic stays deterministic (seed + input stream) so it can be tested.
- Tennis is the only game until the core is solid (rooms, reconnect, logging).
  Don't add a second game unless I ask; keep the registry so one can slot in.
- Video never leaves the browser. The game page's CSP `connect-src` allows
  only this server and the pose model's download hosts (`spec/privacy.test.ts`);
  it also blocks MediaPipe's own usage pings. Don't widen it casually.
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
