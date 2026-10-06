# Webcam Tennis

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
  adapter) and registers in `shared/games/registry.ts`.
- `server/` `index.ts` (http + ws + `/readme/`), `rooms.ts` (60 Hz tick loop,
  seats, spectators), `db.ts` (SQLite on `/data`), `log.ts` (JSON log lines).
  Rooms get their sim from the registry, so networking is game-agnostic.
- `client/` Vite app: `games/<name>/view.ts` (Three.js scene), `input/`
  (keyboard/pointer now, camera later), `net/socket.ts`, `ui/menu.ts`.
- `spec/*.test.ts` vitest against the running app, plus the sim unit tests.
- `e2e/*.e2e.ts` Playwright at both viewports, fake webcam.

## Commands

- `pnpm build && pnpm start` runs the app on :8080 (`DATA_DIR` overrides
  `./data`). `pnpm check` (typecheck + spec) and `pnpm e2e` need it running.
- `pnpm dev:server` + `pnpm dev:client` for hot reload (vite proxies to :8080).
- Docker isn't available in this WSL; CI builds the image, so keep the
  Dockerfile's runtime stage free of dev dependencies.

## Docs

- `tasks/` is the work breakdown (start at `00-overview.md`); update a task's
  status line when it changes.
- `README.md` 400-600 words on what "good" means here (served at `/readme/`).
  `PROCESS.md` 900-1100 words, rewritten each crit.

## Rules

- The server never trusts a client's claim of a hit or a score; it resolves
  hits from swing timestamps against its own sim.
- Game logic stays deterministic (seed + input stream) so it can be tested.
- Tennis is the only game until the core is solid (rooms, reconnect, logging).
  Don't add a second game unless I ask; keep the registry so one can slot in.
- Camera is used for gameplay only. Every camera action has a keyboard/mouse
  equivalent, and the lobby and room work with no camera at all.
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
- Never commit or push on red. Commit when green, in small commits with clear
  messages. Ask before every push (pushing to main deploys once the repo is public).
- Never commit secrets or `mise.local.toml`.
