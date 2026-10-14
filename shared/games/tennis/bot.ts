import { COURT, PLAYER, autoTargetX, naturalKind, seatZ } from "./sim.ts";
import type { Seat, TennisInput, TennisState } from "./sim.ts";

/**
 * The bot plays by the same rules as a person: it moves by the auto-move rule
 * (in auto the sim walks it there at the auto speed; otherwise it sends that
 * target itself) and swings, and the sim applies the speed cap and reach
 * check to both.
 */
export function botInputs(s: TennisState, seat: Seat): TennisInput[] {
  const me = s.players[seat];
  const inputs: TennisInput[] = [];
  if (s.movement[seat].mode !== "auto") {
    const targetX = autoTargetX(s, seat);
    if (targetX !== me.targetX) inputs.push({ t: "move", seat, x: targetX });
  }

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
