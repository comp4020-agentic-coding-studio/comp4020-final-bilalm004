import type { Level } from "../../shared/games/tennis/sim.ts";

// Keyboard, mouse and touch controls: the no-camera way to play.
// A/D move, Space or 2 medium, 1 light, 3 hard. Shots are aimed by timing (as
// with the camera); hold an arrow key while swinging to aim by hand instead.

export interface PlayInput {
  /** Hold or release a move button; dir is on screen (-1 left, 1 right). */
  holdMove(dir: -1 | 1, held: boolean): void;
  /** Current aim in world x, -1..1: arrow keys only. The pointer no longer aims (timing does). */
  aim(): number;
  /** An arrow key is held: the player is aiming by hand and timing aim steps aside. */
  manualAim(): boolean;
  dispose(): void;
}

export interface PlayCallbacks {
  /** dir is in world x (-1, 0 or 1); 0 means stop where you are. */
  move(dir: -1 | 0 | 1): void;
  /** `manual` is true when an arrow key was held: aim by hand, not by timing. */
  swing(level: Level, aim: number, manual: boolean): void;
}

const LEVEL_KEYS: Record<string, Level> = { Digit1: 0, Digit2: 1, Space: 1, Digit3: 2 };

export function createPlayInput(surface: HTMLElement, worldSign: 1 | -1, cb: PlayCallbacks): PlayInput {
  const keys = new Set<string>();
  const buttons = new Set<-1 | 1>();
  let moveDir: -1 | 0 | 1 = 0;

  const keyAim = () => (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0);
  const aim = () => keyAim() * worldSign;
  const manualAim = () => keyAim() !== 0;

  const updateMove = () => {
    const right = keys.has("KeyD") || buttons.has(1);
    const left = keys.has("KeyA") || buttons.has(-1);
    const screen = (right ? 1 : 0) - (left ? 1 : 0);
    const dir = (screen * worldSign) as -1 | 0 | 1;
    if (dir !== moveDir) {
      moveDir = dir;
      cb.move(dir);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code in LEVEL_KEYS) {
      if (e.code === "Space" && e.target instanceof HTMLButtonElement) return;
      e.preventDefault();
      if (!e.repeat) cb.swing(LEVEL_KEYS[e.code], aim(), manualAim());
      return;
    }
    if (e.code.startsWith("Arrow")) e.preventDefault();
    keys.add(e.code);
    updateMove();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    keys.delete(e.code);
    updateMove();
  };
  const onBlur = () => {
    keys.clear();
    buttons.clear();
    updateMove();
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  return {
    holdMove(dir, held) {
      if (held) buttons.add(dir);
      else buttons.delete(dir);
      updateMove();
    },
    aim,
    manualAim,
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    },
  };
}
