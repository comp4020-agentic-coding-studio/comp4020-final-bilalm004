// The score bar at the top of the game screen. It only renders the server's
// ScoreState from each snapshot; it never works a score out for itself.
import { pointCalls } from "../../../shared/games/tennis/scoring.ts";
import type { TennisSnapshot } from "../../../shared/games/tennis/sim.ts";

type Seat = 0 | 1;

// how long a call stays up after a point
export const CALL_MS = 2000;

const FORMAT_NAMES: Record<string, string> = { oneSet: "One set", bestOfThree: "Best of three" };

/**
 * What the umpire would say for the change from `prev` to `next`, or null if
 * nothing was called. A new call is a new `lastCall` from the server. Points
 * are called server first, as in tennis ("15-0", "30-all").
 */
export function scoreCall(prev: TennisSnapshot | null, next: TennisSnapshot, name: (seat: Seat) => string): string | null {
  const call = next.lastCall;
  if (!prev || !call || call.tick === prev.lastCall?.tick) return null;
  if (call.call === "fault") return "Fault";
  if (call.reason === "double fault") return "Double fault";
  const a = prev.score;
  const b = next.score;
  if (b.winner !== null || next.phase === "over") return "Game, set, match";
  // practice starts a fresh match after one is won
  const restarted = b.sets[0] + b.sets[1] < a.sets[0] + a.sets[1];
  if (restarted) return "Game, set, match";
  if (b.sets[0] !== a.sets[0] || b.sets[1] !== a.sets[1]) return "Set";
  if (b.games[0] !== a.games[0] || b.games[1] !== a.games[1]) return "Game";
  const [p0, p1] = b.points;
  const server = b.server;
  if (b.tiebreak) return `${b.points[server]}-${b.points[server === 0 ? 1 : 0]}`;
  if (p0 >= 3 && p1 >= 3) {
    if (p0 === p1) return "Deuce";
    return `Advantage ${name(p0 > p1 ? 0 : 1)}`;
  }
  const calls = pointCalls(b);
  const s = calls[server];
  const r = calls[server === 0 ? 1 : 0];
  return s === r ? `${s}-all` : `${s}-${r}`;
}

export interface ScoreBar {
  update(snap: TennisSnapshot, names: (seat: Seat) => string): void;
  dispose(): void;
}

/** Fills `el` with the bar; `update` with every server snapshot. */
export function createScoreBar(el: HTMLElement): ScoreBar {
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", "Score");
  el.removeAttribute("aria-live");
  const row = (seat: Seat) => `
    <div class="sb-row" data-seat="${seat}">
      <span class="sb-serve" aria-hidden="true"></span>
      <span class="sb-name"></span>
      <span class="sr-only sb-serving"></span>
      <span class="sb-num sb-sets" data-field="sets"></span>
      <span class="sb-num sb-games" data-field="games"></span>
      <span class="sb-num sb-points" data-field="points"></span>
    </div>`;
  el.innerHTML = `${row(0)}${row(1)}
    <div class="sb-foot"><span class="sb-format"></span><span class="sb-call" role="status" aria-live="polite" aria-atomic="true"></span></div>`;
  const callEl = el.querySelector(".sb-call") as HTMLElement;
  const formatEl = el.querySelector(".sb-format") as HTMLElement;
  const cell = (seat: Seat, field: string) => el.querySelector(`[data-seat="${seat}"] [data-field="${field}"]`) as HTMLElement;
  let prev: TennisSnapshot | null = null;
  let timer = 0;

  const set = (target: HTMLElement, text: string, label: string, pulse: boolean) => {
    if (target.textContent !== text) target.textContent = text;
    target.setAttribute("aria-label", `${label} ${text}`);
    if (!pulse) return;
    // restart the animation even if it is still running from the last point
    target.classList.remove("sb-pulse");
    void target.offsetWidth;
    target.classList.add("sb-pulse");
  };

  return {
    update(snap, names) {
      const sc = snap.score;
      const calls = pointCalls(sc);
      const announced = scoreCall(prev, snap, names);
      for (const seat of [0, 1] as const) {
        const r = el.querySelector(`[data-seat="${seat}"]`) as HTMLElement;
        const serving = snap.phase !== "over" && sc.server === seat;
        r.dataset.serving = String(serving);
        r.dataset.won = String(snap.phase === "over" && snap.winner === seat);
        (r.querySelector(".sb-serve") as HTMLElement).textContent = serving ? (sc.faults === 1 ? "2" : "●") : "";
        (r.querySelector(".sb-serving") as HTMLElement).textContent = serving ? (sc.faults === 1 ? " serving, second serve" : " serving") : "";
        const nameEl = r.querySelector(".sb-name") as HTMLElement;
        if (nameEl.textContent !== names(seat)) nameEl.textContent = names(seat);
        const changed = announced !== null && prev !== null;
        set(cell(seat, "sets"), String(sc.sets[seat]), "sets", changed && prev!.score.sets[seat] !== sc.sets[seat]);
        set(cell(seat, "games"), String(sc.games[seat]), "games", changed && prev!.score.games[seat] !== sc.games[seat]);
        set(cell(seat, "points"), calls[seat], "points", changed && prev!.score.points[seat] !== sc.points[seat]);
      }
      const format = snap.endless ? "Practice" : (FORMAT_NAMES[sc.format] ?? sc.format);
      formatEl.textContent = sc.tiebreak ? `${format} · tiebreak` : format;
      if (announced) {
        callEl.textContent = announced;
        el.dataset.call = "on";
        clearTimeout(timer);
        timer = window.setTimeout(() => {
          callEl.textContent = "";
          delete el.dataset.call;
        }, CALL_MS);
      }
      prev = snap;
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}
