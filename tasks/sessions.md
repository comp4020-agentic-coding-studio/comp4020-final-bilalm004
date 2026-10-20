# Parallel sessions (plan of 2026-10-21)

Each session runs in its own terminal and its own git worktree, on its own
branch, so they can run at the same time. Start every session by reading
`CLAUDE.md`, `tasks/00-overview.md` and its own task files. Merge through an
integration branch, run `pnpm check` and `pnpm e2e --workers=1` there, then
fast-forward `main`; ask before every push. Run at most three at once: the e2e
frame-rate tests flake when several browsers compete.

Out of scope for all sessions: the README claims check (task 10) and the ship
check (task 11), and `PROCESS.md` and the reflections, which are the user's.

| Session | Tasks, in order | Model | Touches |
|---|---|---|---|
| A: accounts | 17 Accounts, then 18 Customisation, then 7 Leaderboard and Elo, then 8 Logging | Opus for 17 and 7, Sonnet for 18 and 8 | `server/`, `schema.ts`, protocol, profile and leaderboard UI |
| B: feel | 15 Webcam default, then 16 Top banner, then 19 Crowd and sound | Sonnet for 15, Opus for 16 and 19 | `view.ts`, HUD, camera setup, score bar, new audio module |
| C: arena | 20 Court graphics, then 21 Hit-the-spot training, then 14 Colours and logo, then 23 Home screen polish | Opus for 20, 14 and 23, Sonnet for 21 | `stadium.ts`, `training*.ts`, then `menu.ts` and `style.css` |
| D: archery | its own terminal, planned there with the user | Opus | `shared/games/archery/`, registry, `client/games/archery/` |

## Overlaps to watch
- 19 and 20 both touch the crowd in `stadium.ts`. 20 builds the addressable
  stands; 19 drives them. 19 waits on 20's crowd layout, so B reaches 19 after
  C has merged the layout, or merges 20's crowd part first.
- 17 changes the room's join path (guest and account identity). 15 and 16 touch
  the same files as little as possible; B should rebase on A's merge before the
  final check.
- 7 and archery meet at the registry: leaderboards are keyed by sport id.

## Decisions to remember (user, 2026-10-21)
- **Rated match is an option on the invite**, set by whoever creates the room
  (the host), like the format; a change clears both ready flags. Details in
  task 7.
- **Each sport has its own leaderboard** and its own Elo rating (task 7).
- Leaderboard lists accounts only; guests are never on it.
- Demo accounts become locked accounts, hidden behind a collapsed "Dev tools"
  control on the home screen (also on the live site), so rated play can be
  tested with two of them (tasks 17 and 7).
- Admin removal of entries is not built now; `flyctl ssh` access and Fly volume
  snapshots were checked (notes in task 17).
- Passkeys for sign-in, no Google sign-in for now; accounts are deletable;
  accounts can pick a display name with a server-side profanity check.
- Dedicated sport pages and recorded thumbnails are dropped for now.
- Sounds are synthesised with Web Audio, behind one module.
- Home screen: animated logo (14), arrow cursor and lighter looping SVG/CSS
  thumbnails (23). Spectating mode (24) is written down only, not built now.
- Home-screen files (`menu.ts`, `style.css`) are touched by 14, 17 (Dev tools)
  and 23: session A adds Dev tools after C merges 14 and 23, or rebases onto it.
