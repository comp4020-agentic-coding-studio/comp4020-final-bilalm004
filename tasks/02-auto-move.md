# 2 Auto-move

Status: done (devlog 2026-10-15 02:46); auto speed and the keyboard rule open to playtest
Model: Opus for the rule, Sonnet for wiring

Depends on: shot rules (done)

## Goal
A movement mode, the default, where the server moves you to the ball so you
only practise swinging. Shoulder tilt stays as the other mode; keyboard and
mouse keep their own movement.

## Decisions
- Modes: `auto` (default) and `tilt`. The client states its mode; the server
  applies it to that seat only. Never trust a client claim of position.
- In the sim, auto sets `targetX` from `predictContact` and moves at a capped
  speed, so a wide ball can still beat you.
- The player stops a fixed offset short of the ball, on the side it was heading
  toward, so forehand and backhand are readable situations. Without the offset
  every ball would be hit from straight under it and the kind would be moot.
- The bot follows the same rule.

## How it works (as built)
- `autoTargetX` in `sim.ts`: `AUTO_OFFSET` (0.6 m) short of the predicted
  contact, on the side of the ball's sideways travel (for a straight ball,
  the side of the court it is on). 0.6 m is past `EITHER_SIDE` (0.3) so the
  side is a real choice, and stays within `PLAYER.reach` (1.4) across the hit
  window; the wrong kind is a `"wrong side"` miss. No ball coming: back to
  the middle; a ball past the window keeps the last target.
- `AUTO_SPEED` = 0.7 of `PLAYER.speed` (3.5 m/s) while auto walks you; manual
  moves stay at 5 m/s. User's call: at full speed auto reached almost
  everything and strength stopped mattering. Measured from the far sideline
  (in-landing shots only): full aim reached light 100%, medium 50%, hard 0%;
  straight 100% at every level. 0.6 gave 80/25/0 but cut the bot-vs-bot mean
  rally to 3.76; 0.7 keeps it at 3.91 (3.92 before). Tune by playtest.
- Protocol: `{ t: "mode", mode: "auto" | "tilt" }`, anything else is a bad
  message. The room passes it to the game as an input on the next tick, so it
  is in the input stream (deterministic, replayed by rewind). The snapshot
  carries `movement: [{ mode, manual }, ...]`. A room seeds every new
  occupant with auto; the client then sends its own on every (re)join.
- **Keyboard and touch (decided here, the user may overrule):** every seat
  starts in auto, whatever the input. A move key or ◀ ▶ button is followed at
  the full manual speed and takes over (`manual`) until the next ball is
  struck toward you, then auto resumes. So keyboard players get the help by
  default and can still run anywhere. The mode toggle lives under the camera
  preview; a keyboard-only player can't switch to `tilt`, and doesn't need
  to, since in either mode their keys move them.
- Camera: in auto the client sends no lean targets and the lean gauge is
  dimmed. "Move: auto / Move: lean" button in `.cam-dock`, remembered in
  localStorage (`move-mode`), auto if storage is blocked.

## Done when
- [x] Sim tests: reaches reachable balls, never exceeds speed cap, side offset
      gives the expected kind (`spec/auto-move.test.ts`; also: beyond reach is
      still missed, strength ordering of reach rates, determinism, rewind).
- [x] Protocol carries the movement mode; validation rejects unknown values
      (`spec/rooms.test.ts`, "movement mode"; one seat's mode leaves the other's).
- [x] Spec over WebSocket: in auto the server walks you to the ball with no moves.
- [x] e2e at both viewports: toggle, default, remembered, no overlap
      (`e2e/auto-move.e2e.ts`).
- [x] `pnpm check` green.
