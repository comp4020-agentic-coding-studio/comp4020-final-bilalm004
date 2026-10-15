# Reaction time and movement: measured numbers

Measured on the real sim (`shared/games/tennis/sim.ts`) on 2026-10-15, as at
commit 7496133. These are the figures to quote in training mode and the README;
re-measure after changing `STROKES`, `AUTO_SPEED`, `PLAYER` or `HIT_WINDOW_S`.

## The constants
- Manual speed 5 m/s; auto-move 0.7 of that (3.5 m/s). Reach 1.4 m sideways.
- Hit window 0.32 s either side of your baseline; early / on time / late are
  about 0.21 s each.

## Reaction time comes from ball speed, not depth
Flight from the hit to the receiver's baseline is about 22 m / forward speed.

| Strength | Forward speed | Flight to the far baseline | Bounces at |
|---|---|---|---|
| Light | 11 m/s | 1.98 s | 4 m past the net |
| Medium | 14 m/s | 1.57 s | 6 m |
| Hard | 18 m/s | 1.22 s | 8.2 m |

The ball keeps all its forward speed after the bounce, and contact height
doesn't change the time. Depth only decides where it bounces and how high it
arrives. To make depth affect reaction time, the ball would need to slow after
the bounce; that is not done.

## Movement uses up that time (upper bound: you move the instant it is hit)
Run needed = the ball's sideways gap minus your 1.4 m reach, over the flight.

- **From the middle**, nothing that lands in needs more than about 1.9 m/s
  (medium, full aim: 3.0 m of running in 1.57 s). Auto-move (3.5 m/s) reaches
  every in-bounds ball. A full-aim hard shot lands out.
- **From 2 m out**, auto reaches 100% of in-bounds returns at every strength.
- **From 4 m out (near the edge)**, auto reaches 100% of light, 80% of medium
  and 67% of hard; manual reaches all of them.

So auto-move being slower than manual only bites when you are out of position,
which is where strength should matter: recovering toward the middle is the skill.

## Not measured yet
- Human and camera reaction delay (a camera swing lands about 0.1 s late at
  best). Even 0.3 s off the flight moves the edge cases a lot (4 m out, hard:
  only 1.22 s in total).
- Which returns a real opponent chooses (every aim was weighted equally).
- Tilt movement, which is slower and less precise than either speed.
- Whether auto-move recovers toward the middle between shots (assumed it stays
  where the last hit left it).

## Method note
A first probe gave 0.43 s and x = 0 for every shot. It was wrong: the swing
was made by the seat that had hit last, so the sim refused it ("no ball") and
the ball never launched. Probes must check the swing outcome is "hit".
