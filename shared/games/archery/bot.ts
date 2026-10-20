import { predictHit } from "./sim.ts";
import type { Aim, ArcheryInput, ArcheryState, Seat, Wind } from "./sim.ts";

/** The bot draws for this long, then holds, then lets go. */
export const BOT_DRAW_TICKS = 50;
export const BOT_RELEASE_TICK = 80;
/** The bot's draw: firm but not full, like a person. */
const BOT_DRAW = 0.85;

/**
 * The aim that lands `aim.draw` at the target centre in `wind`: a few rounds
 * of correcting yaw and pitch by the miss. Used by the bot, and by tests.
 */
export function solveAim(distance: number, wind: Wind, draw: number): Aim {
  let aim: Aim = { yaw: 0, pitch: 0, draw };
  for (let i = 0; i < 12; i++) {
    const hit = predictHit(aim, distance, wind);
    if (!hit) {
      aim = { ...aim, pitch: aim.pitch + 0.05 };
      continue;
    }
    if (Math.hypot(hit.x, hit.y) < 0.001) break;
    aim = { ...aim, yaw: aim.yaw - Math.atan2(hit.x, distance), pitch: aim.pitch - Math.atan2(hit.y, distance) };
  }
  return aim;
}

// A number in [0, 1) from the state without touching its rng, so asking the
// bot never changes the game.
function noise(s: ArcheryState, salt: number): number {
  let t = (s.rng ^ Math.imul(s.shots.length + 1, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * The bot plays by the same rules as a person: it sends an aim while it draws
 * and one release, and the sim flies the arrow. It reads the wind but not
 * perfectly, and its hand wobbles more the farther the target.
 */
export function botInputs(s: ArcheryState, seat: Seat): ArcheryInput[] {
  if (s.phase !== "aim" || s.turn !== seat) return [];
  const misread = 1 + (noise(s, 1) - 0.5) * 0.5;
  const target = solveAim(s.distance, { speed: s.wind.speed * misread, angle: s.wind.angle }, BOT_DRAW);
  // wobble at the face in metres, as an angle: about a ring and a half at 50 m
  const spread = (0.03 + 0.0025 * s.distance) / s.distance;
  const yaw = target.yaw + (noise(s, 2) - 0.5) * 2 * spread;
  const pitch = target.pitch + (noise(s, 3) - 0.5) * 2 * spread;
  if (s.phaseTick >= BOT_RELEASE_TICK) return [{ t: "release", seat, yaw, pitch, draw: BOT_DRAW }];
  const draw = BOT_DRAW * Math.min(1, s.phaseTick / BOT_DRAW_TICKS);
  return s.phaseTick % 3 === 0 ? [{ t: "aim", seat, yaw, pitch, draw }] : [];
}

