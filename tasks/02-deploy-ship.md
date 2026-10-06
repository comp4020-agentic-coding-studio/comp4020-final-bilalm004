# 02 First deploy and ship

Status: not started (scaffold is committed locally, not pushed)
Model: Sonnet

## Goal
The scaffold running at `https://<repo-name>.fly.dev`, with CI green and the
deploy path proven before any real features depend on it.

## Scope
- Confirm the Docker image builds (can't be done in this WSL; CI or
  `flyctl deploy --remote-only` is the first real build).
- Fly token in `mise.local.toml` (gitignored), volume mounted at `/data`.
- Check `node:sqlite` works on the volume and the app fits 256 MB.
- Use `/comp4020:preflight` then `/comp4020:ship` (flips repo public, enables
  CI deploy, tags the crit cutoff).

## Done when
- [ ] `flyctl deploy --remote-only --ha=false -a <repo>` succeeds.
- [ ] Live `/` is 200, `/readme/` renders, a practice game runs on the live URL.
- [ ] Data survives a redeploy (check a match row persists).
- [ ] CI `check` job green on the pushed commit.
- [ ] Pushed only after asking (CLAUDE.md rule).

## Risks
Image-only failures (missing runtime file, prod install) won't show locally.
Keep the runtime stage free of dev dependencies.
