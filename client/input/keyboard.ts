export interface SwingInput {
  dispose(): void;
}

const SWING_POWER = 0.6;

export function createSwingInput(
  surface: HTMLElement,
  aimSign: 1 | -1,
  onSwing: (dirX: number, power: number) => void,
): SwingInput {
  let keyAim = 0;
  const held = new Set<string>();

  const updateAim = () => {
    keyAim = (held.has("ArrowRight") || held.has("d") ? 1 : 0) - (held.has("ArrowLeft") || held.has("a") ? 1 : 0);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.key === " " || e.key === "Enter") {
      if (e.target instanceof HTMLButtonElement) return;
      e.preventDefault();
      onSwing(keyAim * aimSign, SWING_POWER);
      return;
    }
    held.add(e.key);
    updateAim();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    held.delete(e.key);
    updateAim();
  };
  const onPointer = (e: PointerEvent) => {
    if (e.target !== surface) return;
    const rect = surface.getBoundingClientRect();
    const aim = (e.clientX - rect.left) / rect.width - 0.5;
    onSwing(Math.max(-1, Math.min(1, aim * 2)) * aimSign, SWING_POWER);
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  surface.addEventListener("pointerdown", onPointer);

  return {
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      surface.removeEventListener("pointerdown", onPointer);
    },
  };
}
