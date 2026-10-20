# 7 Leaderboard and ratings

Status: partial (players and match results are stored with sets, games, format and a `rated` flag, schema v2 from task 1; nothing reads them yet). Unlimited matches (task 4) must be stored unrated. Rewritten 2026-10-21 for accounts.
Model: Opus (the rating rules matter)
Session: A, after 17 (needs accounts)

## Goal
Give people a reason to come back tomorrow, and prove data survives restarts
and redeploys.

## Decided (user, 2026-10-21)
- The leaderboard lists **accounts only**. Guests are never on it.
- Rating is **Elo**: start 1000, K = 32, updated at match end. The README states
  the formula.
- Whether a match is rated is **an option on the invite, set by whoever creates
  the room** (the host), chosen before play like the format. A change clears
  both ready flags, as the format does.
- Players want their own score on the board: show your rating and rank.
- **Each sport has its own leaderboard** and its own rating: an account has one
  Elo per sport (tennis now, archery when it exists), each starting at 1000. A
  match only moves the rating of the sport it was played in. Build it keyed by
  sport id from the start (a `sport` column on the rating rows and on
  `matches`), so adding a sport needs no schema change to ratings. The sport
  list is the registry's (`shared/games/registry.ts`); the leaderboard page has
  a tab per registered playable sport. Archery is a separate session; this task
  only has to leave room for it.

## Rated means all of
Host turned "rated" on, both seats are signed-in accounts on different tokens,
it is a real room (not practice vs bot, not training), the format has a winner
(not unlimited), and the match finished (not left mid-match). Anything else is
stored `rated = 0`. A guest in the room means the option shows as unavailable
with the reason. Ratings read only `rated = 1` rows (a test enforces it).

The two demo accounts (task 17) count as accounts for this, so two of them can
play a rated match to test it; they are hidden from the public board.

## Scope
- Elo update when a rated match ends, in one db transaction with the match row.
- Leaderboard page, one tab per sport: top accounts by that sport's rating with
  wins and losses; your row is highlighted, and your rank is shown even when
  outside the top list. Updates
  within about a second when a rated match finishes (live push or short poll;
  pick the simpler one that meets this).
- Match history per account and longest-rally record (needs rally length in the
  sim state).
- Profile and lobby show your rating.
- Deleted accounts leave the board and show as "Deleted player" in history
  (task 17).
- Schema migration for anything new, with a test from the previous version.

## Done when
- [ ] Finish a rated match, restart the server: rating and history are still
      there (spec test that restarts the app, or a db-level test).
- [ ] Rated option: host sets it, a change clears ready, a guest seat makes it
      unavailable; the server decides, a hostile client cannot force it.
- [ ] Elo test table (equal ratings, upset, floor) and a test that unrated
      matches never change a rating.
- [ ] A match in one sport never changes another sport's rating (test with a
      second, fake registered sport), and each sport's board lists only its own.
- [ ] Leaderboard updates in a second session within about a second.
- [ ] Both viewports; CLAUDE.md room rules, README and `spec/` agree.
- [x] Migration test pattern exists (`spec/db.test.ts`).
- [x] Practice-vs-bot matches don't affect ratings (`rated = 0`).
