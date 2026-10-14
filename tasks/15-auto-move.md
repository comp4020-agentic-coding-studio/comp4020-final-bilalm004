# 15 Auto-move

Status: planned
Model: Opus for the rule, Sonnet for wiring

Depends on: 12

## Goal
A movement mode, the default, where the server moves you to the ball so you
only practise swinging. Shoulder tilt stays as the other mode; keyboard and
mouse keep their own movement.

## Decisions
- Modes: `auto` (default) and `tilt`. The client states its mode; the server
  applies it to that seat only. Never trust a client claim of position.
- In the sim, auto sets `targetX` from `predictContact` and moves at the normal
  capped player speed, so a wide ball can still beat you.
- The player stops a fixed offset short of the ball, on the side it was heading
  toward, so forehand and backhand are readable situations. Without the offset
  every ball would be hit from straight under it and the kind would be moot.
- The bot follows the same rule.

## Done when
- [ ] Sim tests: reaches reachable balls, never exceeds speed cap, side offset
      gives the expected kind.
- [ ] Protocol carries the movement mode; validation rejects unknown values.
- [ ] `pnpm check` green.
