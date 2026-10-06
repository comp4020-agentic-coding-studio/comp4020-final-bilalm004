export const DT = 1 / 60;

export const COURT = {
  halfW: 4.1,
  halfL: 11,
  netH: 0.9,
  gravity: 9.8,
  restitution: 0.72,
  hitWindow: 1.6,
  endMargin: 3,
  winScore: 5,
  serveDelayTicks: 75,
} as const;

export type Seat = 0 | 1;

export interface Ball {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface TennisState {
  tick: number;
  phase: "serve" | "rally" | "over";
  phaseTick: number;
  server: Seat;
  ball: Ball;
  lastHitter: Seat | null;
  bounces: number;
  score: [number, number];
  winner: Seat | null;
  rng: number;
}

export type TennisSnapshot = Omit<TennisState, "rng">;

export interface Swing {
  seat: Seat;
  dirX: number;
  power: number;
}

export const seatZ = (seat: Seat): number => (seat === 0 ? COURT.halfL : -COURT.halfL);
const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function random(s: TennisState): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function resetServe(s: TennisState): void {
  s.phase = "serve";
  s.phaseTick = 0;
  s.lastHitter = null;
  s.bounces = 0;
  s.ball = { x: 0, y: 1, z: seatZ(s.server), vx: 0, vy: 0, vz: 0 };
}

export function createState(seed: number): TennisState {
  const s: TennisState = {
    tick: 0,
    phase: "serve",
    phaseTick: 0,
    server: 0,
    ball: { x: 0, y: 1, z: seatZ(0), vx: 0, vy: 0, vz: 0 },
    lastHitter: null,
    bounces: 0,
    score: [0, 0],
    winner: null,
    rng: seed >>> 0,
  };
  resetServe(s);
  return s;
}

export function snapshot(s: TennisState): TennisSnapshot {
  return {
    tick: s.tick,
    phase: s.phase,
    phaseTick: s.phaseTick,
    server: s.server,
    ball: { ...s.ball },
    lastHitter: s.lastHitter,
    bounces: s.bounces,
    score: [s.score[0], s.score[1]],
    winner: s.winner,
  };
}

function awardPoint(s: TennisState, winner: Seat): void {
  s.score[winner]++;
  if (s.score[winner] >= COURT.winScore) {
    s.phase = "over";
    s.winner = winner;
    return;
  }
  s.server = other(s.server);
  resetServe(s);
}

function launchServe(s: TennisState): void {
  const dir = s.server === 0 ? -1 : 1;
  s.ball = {
    x: (random(s) - 0.5) * 3,
    y: 1.2,
    z: seatZ(s.server),
    vx: (random(s) - 0.5) * 2,
    vy: 4.5,
    vz: dir * 13,
  };
  s.phase = "rally";
  s.lastHitter = s.server;
  s.bounces = 0;
}

function tryHit(s: TennisState, swing: Swing): void {
  if (s.phase !== "rally" || s.lastHitter === swing.seat) return;
  const b = s.ball;
  const heading = swing.seat === 0 ? b.vz > 0 : b.vz < 0;
  if (!heading || Math.abs(b.z - seatZ(swing.seat)) > COURT.hitWindow) return;
  const power = clamp(swing.power, 0, 1);
  const dir = swing.seat === 0 ? -1 : 1;
  b.vz = dir * (11 + 5 * power);
  b.vx = clamp(swing.dirX, -1, 1) * 2.5;
  b.vy = 4.8 + 0.9 * power;
  s.lastHitter = swing.seat;
  s.bounces = 0;
}

function onBounce(s: TennisState): void {
  const b = s.ball;
  const hitter = s.lastHitter as Seat;
  const inBounds = Math.abs(b.x) <= COURT.halfW && Math.abs(b.z) <= COURT.halfL;
  if (!inBounds) return awardPoint(s, other(hitter));
  const hitterSide = hitter === 0 ? 1 : -1;
  if (Math.sign(b.z) === hitterSide) return awardPoint(s, other(hitter));
  s.bounces++;
  if (s.bounces >= 2) awardPoint(s, hitter);
}

export function step(s: TennisState, swings: readonly Swing[]): void {
  s.tick++;
  s.phaseTick++;
  if (s.phase === "over") return;
  if (s.phase === "serve") {
    if (s.phaseTick >= COURT.serveDelayTicks) launchServe(s);
    return;
  }

  for (const swing of swings) tryHit(s, swing);

  const b = s.ball;
  const prevZ = b.z;
  b.vy -= COURT.gravity * DT;
  b.x += b.vx * DT;
  b.y += b.vy * DT;
  b.z += b.vz * DT;

  if (prevZ > 0 !== b.z > 0 && b.y < COURT.netH) {
    return awardPoint(s, other(s.lastHitter as Seat));
  }
  if (b.y < 0) {
    b.y = 0;
    b.vy = -b.vy * COURT.restitution;
    onBounce(s);
    if (s.phase !== "rally") return;
  }
  if (Math.abs(b.z) > COURT.halfL + COURT.endMargin) {
    const hitter = s.lastHitter as Seat;
    awardPoint(s, s.bounces >= 1 ? hitter : other(hitter));
  }
}
