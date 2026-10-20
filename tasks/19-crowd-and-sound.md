# 19 Crowd reactions and sound

Status: queued
Model: Opus for the design and the audio module, Sonnet for wiring and tests
Session: B, after 16 (shares `view.ts`, the HUD and the stage) and after 20 if
both touch the crowd in `stadium.ts`

## Goal
The crowd reacts to every point, and you hear it.

## Decided (user, 2026-10-21)
- One side of the stands cheers and the other is down. The front stand is split
  in half by which player you are.
- The loser's side boos or shakes its head.
- Cheering has a sound. More sound effects overall. When you score, your side
  claps.
- Synthesise the audio with Web Audio, no asset files (my recommendation, the
  user asked for it). Keep every sound behind one small module so a few CC0
  clips could replace the boo or cheer later without touching anything else.

## Scope
- **Crowd (visual):** the stands are split by seat: seat one's side and seat
  two's side. After a point, the scorer's side cheers (arms up, jumping) and the
  other side boos and shakes heads. The front stand is half and half the same
  way. A game or set point is a bigger reaction. Spectators see it by seat, with
  seat one on the left and seat two on the right. Instanced, cheap, flat
  shaded; keep the frame rate.
- **Sound:** clapping (layered, delayed filtered-noise bursts), a crowd roar
  swell, a boo (low gliding tone under noise), and the extra effects: a clap for
  the scorer's side, a whistle or soft gasp on a fault, a light cheer on a good
  shot. Hit and bounce sounds if cheap.
- **Controls:** a mute toggle (remembered locally), a master volume, and audio
  that starts only after the first user gesture (browser autoplay rules).
  Muted means no audio nodes are created.
- **Local only:** driven by the score snapshot every client already receives.
  No new network messages (the spec on allowed messages must still pass). The
  server stays the only owner of the score.
- prefers-reduced-motion: the crowd still changes pose but without the jumping
  loop.

## Done when
- [ ] Crowd reaction table-tested: for each score change, which side cheers and
      which is down, for seat one, seat two, bot point, and a spectator.
- [ ] Sound module has a unit test (mute creates nothing; no audio before a
      gesture) and the sounds are a pure function of the score event.
- [ ] Both viewports; no horizontal scroll; the mute button reachable on a phone.
- [ ] Frame rate not lower than before in the trail e2e test.
- [ ] CLAUDE.md layout and README mention sound and the mute toggle.
