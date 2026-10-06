import { COURT, PLAYER, naturalKind, predictContact, seatZ } from "./sim.ts";
import type { Seat, TennisInput, TennisState } from "./sim.ts";

/**
 * The bot plays by the same rules as a person: it sends a move target and
 * swings, and the sim applies the speed cap and reach check to both.
 */
export function botInputs(s: TennisState, seat: Seat): TennisInput[] {
  const contact = predictContact(s, seat);
  const me = s.players[seat];
  const targetX = contact ? contact.ball.x : 0;
  const inputs: TennisInput[] = [];
  if (targetX !== me.targetX) inputs.push({ t: "move", seat, x: targetX });

  const b = s.ball;
  const heading = seat === 0 ? b.vz > 0 : b.vz < 0;
  const close = Math.abs(b.z - seatZ(seat)) <= COURT.hitWindow * 0.5;
  if (s.phase === "rally" && s.lastHitter !== seat && heading && close && Math.abs(b.x - me.x) <= PLAYER.reach) {
    inputs.push({
      t: "swing",
      seat,
      dirX: Math.sin(s.tick * 0.37) * 0.8,
      kind: naturalKind(seat, me.x, b.x),
      level: 1,
    });
  }
  return inputs;
}
