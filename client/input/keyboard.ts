import type { Level } from "../../shared/games/tennis/sim.ts";

// Keyboard, mouse and touch controls: the no-camera way to play.
// A/D move, arrows or pointer aim, Space or 2 medium, 1 light, 3 hard.

export interface PlayInput {
  /** Hold or release a move button; dir is on screen (-1 left, 1 right). */
  holdMove(dir: -1 | 1, held: boolean): void;
  /** Current aim in world x, -1..1. */
  aim(): number;
  dispose(): void;
}

export interface PlayCallbacks {
  /** dir is in world x (-1, 0 or 1); 0 means stop where you are. */
  move(dir: -1 | 0 | 1): void;
  swing(level: Level, aim: number): void;
}

const LEVEL_KEYS: Record<string, Level> = { Digit1: 0, Digit2: 1, Space: 1, Digit3: 2 };

export function createPlayInput(surface: HTMLElement, worldSign: 1 | -1, cb: PlayCallbacks): PlayInput {
  let pointerAim = 0;
  const keys = new Set<string>();
  const buttons = new Set<-1 | 1>();
  let moveDir: -1 | 0 | 1 = 0;

  const keyAim = () => (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0);
  const aim = () => (keyAim() !== 0 ? keyAim() : pointerAim) * worldSign;

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
      if (!e.repeat) cb.swing(LEVEL_KEYS[e.code], aim());
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
  const onPointer = (e: PointerEvent) => {
    if (e.target !== surface) return;
    if (e.type === "pointermove" && e.pointerType !== "mouse" && e.buttons === 0) return;
    const rect = surface.getBoundingClientRect();
    pointerAim = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width - 0.5) * 2));
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  surface.addEventListener("pointerdown", onPointer);
  surface.addEventListener("pointermove", onPointer);

  return {
    holdMove(dir, held) {
      if (held) buttons.add(dir);
      else buttons.delete(dir);
      updateMove();
    },
    aim,
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      surface.removeEventListener("pointerdown", onPointer);
      surface.removeEventListener("pointermove", onPointer);
    },
  };
}
