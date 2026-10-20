# 17 Accounts: passkeys, profile, display name, deletion

Status: queued
Model: Opus (schema, security and the rules in CLAUDE.md change)
Session: A (first). Tasks 18 and 7 wait on this one.

## Goal
Anonymous profile first, passkeys to claim and recover it. No passwords, no
secrets, safe in a public repo.

## Decided (user, 2026-10-21)
- Passkeys (WebAuthn) are the sign-in. No Google sign-in for now.
- Guests keep full matches, but are not on the leaderboard and cannot be rated.
- Accounts can choose a display name (limits below).
- Accounts can be deleted by the player.
- Fly.io has no player sign-in service (its login is for deploying only), so
  accounts are built into the game, stored in SQLite on `/data`.

## Scope
- **Guest profile:** random id in a cookie, created on first visit. Replaces the
  current token-to-pseudonym path without breaking reconnect (the same token
  must still reclaim a held seat; see CLAUDE.md room rules).
- **Passkeys:** register to claim the current guest profile (its history is
  kept); sign in on another device; add and remove passkeys while signed in
  (not removing the last one without confirmation). Use `@simplewebauthn/server`
  (and its browser counterpart); do not hand-roll signature checks. It must be a
  runtime dependency in the Dockerfile's runtime stage.
- **Security:** challenges random, single-use, short-lived; check origin and rp
  id on every ceremony; session cookie is 256 random bits with only its hash
  stored, `HttpOnly`, `Secure` (except on localhost), `SameSite=Lax`; rate-limit
  register and sign-in; no credential or session value in logs. Passkeys are
  bound to the domain: note in the README that dev and the Fly URL are separate
  registrations.
- **Display name:** 3 to 16 characters, letters, digits, spaces and a few
  symbols, unique (case-insensitive). Profanity check on the server with the
  `obscenity` package (its word list ships inside the package; we store none);
  the client may pre-check but is never trusted. Reserved: "Bot", "Admin", and
  anything shaped like `<name> (2)` (the two-tab label). Guests keep a
  server-made pseudonym. Admin renames or removes a name by hand in the db;
  document the command in the README.
- **Delete account:** re-authenticate with a passkey, then confirm. Removes
  passkeys, sessions, display name, look and leaderboard row. Past `matches`
  rows stay, so opponents' records do not change; the player shows as
  "Deleted player" with nothing linking back.
- **Schema:** new steps in `server/schema.ts` (never edit an old step) with a
  test that opens a database made by the previous version.
- **UI:** a small profile panel (name, passkeys, sign out, delete) reachable
  from the home screen, working at 1920x1080 and 390x844. Play never requires
  signing in.

## Demo accounts and "Dev tools" (user, 2026-10-21)
- Today "Demo One" and "Demo Two" are guest tokens (`server/db.ts`) with
  "Sign in as Demo One / Two" buttons on the home screen. Move those buttons
  behind a collapsed **Dev tools** control on the home screen, closed by
  default, so players don't see them but the user can open it later, on the
  live site too.
- Seed the two demo accounts as real accounts with a `demo` flag and no
  passkeys, so two of them can play a rated match (task 7). They are locked:
  not renameable, not deletable, no passkey can be attached, and they are
  hidden from the public leaderboard (their own rating still updates).
- The client still only asks for "demo 1 or 2"; it never supplies an identity.
- The Dev tools control must be keyboard reachable and work at both viewports.

## Removing entries later (checked 2026-10-21; not to be built now)
- `flyctl ssh console -a comp4020-final-bilalm004 -C "<cmd>"` works with the
  course token (listed `/data`; runs as root). So a later admin script can run
  on the live machine against `/data/app.db`. It would need adding to the
  Dockerfile's runtime stage (only `shared`, `server`, `docs` and `README.md`
  are copied today).
- The db is in WAL mode: open it with `node:sqlite` (never copy `app.db` alone),
  and use `VACUUM INTO` for a manual backup before an admin delete.
- Fly snapshots the volume about daily and keeps 5 days (3 present when
  checked). Restore is a new volume from a snapshot. Take one by hand first:
  `flyctl volumes snapshots create vol_49122gk5j8qm2p3r -a comp4020-final-bilalm004`.
- If ratings are updated incrementally, deleting an old match leaves later
  ratings wrong; recomputing from `rated = 1` rows in order (task 7) fixes that.

## Rules to change in the same commit
CLAUDE.md says "Names are server-made pseudonyms, not renameable". Update that
rule, the layout section, and the spec that enforces it, together.

## Done when
- [ ] Register a passkey, sign out, sign in again, on a virtual authenticator
      (Playwright's CDP WebAuthn emulator) at both viewports.
- [ ] Guest history survives claiming; held-seat reconnect still works.
- [ ] Name rules tested: length, characters, uniqueness, reserved, profanity,
      and a hostile client sending a name directly.
- [ ] Delete test: no identifying row remains; match rows stay.
- [ ] Demo accounts: hidden behind Dev tools by default, seeded as locked
      accounts, rejected by rename, delete and passkey attach, absent from the
      public board; `e2e/home.e2e.ts` (which clicks the demo buttons) updated
      to open Dev tools first.
- [ ] Migration test from the previous schema version.
- [ ] CSP unchanged; `spec/privacy.test.ts` passes; no new third-party host.
- [ ] CLAUDE.md, README and `spec/` agree about names and accounts.
