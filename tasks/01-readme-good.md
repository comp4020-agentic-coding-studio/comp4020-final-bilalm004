# 01 README: what "good" means

Status: not started (README.md is still the template)
Model: Opus

## Goal
`README.md`, 400-600 words, published at `/readme/`. It defines "good" for this
app and the markers check it against `CLAUDE.md` and `spec/`.

## Scope
- Who the users are (pseudonymous players, invited friends, spectators).
- What persists, what has history, who sees what.
- What "good" means here, stated as claims you can test: fair hits under
  latency, a room that never lies about who is there, video never leaves the
  browser, playable with no camera, works at 1920x1080 and 390x844.
- Screenshots in `docs/`, linked relatively (`![alt](docs/x.png)`); the server
  already serves `/readme/docs/*`.

## Done when
- [ ] 400-600 words, every claim has a matching rule in `CLAUDE.md` or a test
      in `spec/` (list them in the PR/commit message).
- [ ] `/readme/` shows every heading, in order (`pnpm check` covers this).
- [ ] Rewritten, not appended, at each crit.
- [ ] Doesn't promise anything the app doesn't do yet at that crit.

## Notes
Do this after 05's decisions are made; the rules are the content.
