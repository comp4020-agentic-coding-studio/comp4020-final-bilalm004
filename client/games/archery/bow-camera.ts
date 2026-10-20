import type { Hand } from "../../../shared/games/tennis/sim.ts";
import { CameraError, openCamera, startPose } from "../../input/camera/camera.ts";
import type { CameraSession } from "../../input/camera/camera.ts";
import type { CameraFrame } from "../../input/camera/pose.ts";
import { BowTracker, DEFAULT_BOW, drawHandOpenness, readBow } from "./bow.ts";
import type { BowReading } from "./bow.ts";

// Archery's camera (task 22): the same webcam and local pose model as tennis
// (video never leaves the browser), read as a bow instead of a racket. The
// panel only asks which hand holds the bow; there is nothing to calibrate.
// Every step can be skipped, and keys, mouse and the hold button still work.

export interface BowCallbacks {
  aim(a: BowReading): void;
  release(a: BowReading): void;
  letdown(): void;
  /** The setup panel opened (true) or closed (false); practice holds the game meanwhile. */
  pause(paused: boolean): void;
}

export interface BowCamera {
  /** The camera is running and shooting for you (keys and mouse step aside). */
  on(): boolean;
  /** For the ready panel: off, on but not seeing you, or tracking. */
  state(): "off" | "on" | "ok";
  dispose(): void;
}

const HAND_KEY = "archery-bow-hand";

function loadHand(): Hand {
  try {
    return localStorage.getItem(HAND_KEY) === "right" ? "right" : "left";
  } catch {
    return "left";
  }
}

function saveHand(h: Hand): void {
  try {
    localStorage.setItem(HAND_KEY, h);
  } catch {
    // storage unavailable: left next time
  }
}

export function createBowCamera(view: HTMLElement, button: HTMLButtonElement, chip: HTMLElement, cb: BowCallbacks): BowCamera {
  const video = document.createElement("video");
  video.className = "selfview";
  video.hidden = true;
  video.setAttribute("aria-label", "Your camera preview, not sent anywhere");
  const dock = document.createElement("div");
  dock.className = "cam-dock";
  // what the camera reads, so a player can see the open hand register
  const readout = document.createElement("div");
  readout.className = "ar-hand";
  readout.setAttribute("role", "status");
  readout.hidden = true;
  readout.innerHTML = `<span class="ar-hand-label"></span><span class="ar-hand-bar"><i></i></span>`;
  dock.append(video, readout);
  const readLabel = readout.querySelector(".ar-hand-label") as HTMLElement;
  const readBar = readout.querySelector(".ar-hand-bar i") as HTMLElement;
  const panel = document.createElement("section");
  panel.className = "camera-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Camera setup");
  panel.hidden = true;
  view.append(dock, panel);

  let hand = loadHand();
  let session: CameraSession | null = null;
  let starting = false;
  let tracking = false;
  const tracker = new BowTracker();

  const setChip = (text: string, state: "ok" | "warn" | "off") => {
    chip.hidden = false;
    chip.textContent = text;
    chip.dataset.state = state;
  };

  const onFrame = (f: CameraFrame) => {
    const r = f.landmarks ? readBow(f.landmarks, f.aspect, hand) : null;
    tracking = r !== null;
    setChip(r ? "Tracking" : "Can't see both hands", r ? "ok" : "warn");
    const open = f.landmarks && f.hands ? drawHandOpenness(f.landmarks, f.hands, f.aspect, hand) : null;
    if (!session?.hands) readLabel.textContent = "Fingers: not read (snap forward to shoot)";
    else if (open === null) readLabel.textContent = f.hands?.length ? "Pulling hand: not found" : "Hands: not seen";
    else readLabel.textContent = `Pulling hand: ${open >= DEFAULT_BOW.openAt ? "open" : "closed"} ${Math.round(open * 100)}%`;
    readBar.style.width = `${Math.round((open ?? 0) * 100)}%`;
    readout.dataset.open = String(open !== null && open >= DEFAULT_BOW.openAt);
    const e = tracker.update(r, f.t, open);
    if (!e) return;
    if (e.t === "aim") cb.aim(e);
    else if (e.t === "release") cb.release(e);
    else cb.letdown();
  };

  const close = () => {
    panel.hidden = true;
    cb.pause(false);
  };

  const stop = () => {
    session?.stop();
    session = null;
    tracking = false;
    tracker.reset();
    video.hidden = true;
    readout.hidden = true;
    chip.hidden = true;
    button.textContent = "Camera";
  };

  const fail = (message: string) => {
    stop();
    panel.innerHTML = `<h2>No camera</h2><p class="error" role="alert"></p><div class="row"><button class="primary" data-step="close">OK</button></div>`;
    (panel.querySelector(".error") as HTMLElement).textContent = message;
    panel.querySelector("[data-step=close]")?.addEventListener("click", close);
  };

  const start = async () => {
    if (starting) return;
    starting = true;
    panel.innerHTML = `<h2>Starting camera…</h2><p class="muted" role="status">Waiting for permission.</p>`;
    try {
      const stream = await openCamera(video);
      video.hidden = false;
      panel.innerHTML = `<h2>Loading pose model…</h2><p class="muted" role="status">The first time takes a few seconds.</p>`;
      setChip("Loading…", "warn");
      session = await startPose(video, stream, onFrame, () => {}, { hands: true });
      button.textContent = "Stop camera";
      readout.hidden = false;
      close();
    } catch (err) {
      fail(err instanceof CameraError ? err.message : "The camera didn't start. Keep playing with the mouse or keys.");
    } finally {
      starting = false;
    }
  };

  const intro = () => {
    panel.innerHTML = `
      <h2>Shoot with your camera</h2>
      <ol>
        <li>Stand side-on or facing the screen, both hands in view.</li>
        <li>Hold your aiming hand out in front: moving it aims.</li>
        <li>Make a fist with your other hand and pull it back: the farther, the stronger.</li>
        <li>Open that hand to let go and shoot. Bring it back slowly, still closed, to cancel.</li>
      </ol>
      <fieldset class="row" aria-label="Aiming hand">
        <legend>Aiming hand</legend>
        <button type="button" data-hand="left">Left (pull with right)</button>
        <button type="button" data-hand="right">Right (pull with left)</button>
      </fieldset>
      <details class="rp-safety"><summary>Before you start</summary>
        <ul><li>Clear the space around you.</li><li>Hold nothing: there is no real bow or string.</li><li>Stop if anything hurts.</li></ul>
      </details>
      <p class="muted">The video stays in this browser; only the pose is used.</p>
      <div class="row">
        <button class="primary" data-step="start">Start camera</button>
        <button data-step="close">Not now</button>
      </div>`;
    const handButtons = panel.querySelectorAll<HTMLButtonElement>("[data-hand]");
    const mark = () => handButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.hand === hand)));
    handButtons.forEach((b) =>
      b.addEventListener("click", () => {
        hand = b.dataset.hand as Hand;
        saveHand(hand);
        mark();
      }),
    );
    mark();
    panel.querySelector("[data-step=start]")?.addEventListener("click", () => void start());
    panel.querySelector("[data-step=close]")?.addEventListener("click", close);
  };

  const onButton = () => {
    if (session) {
      stop();
      return;
    }
    panel.hidden = false;
    cb.pause(true);
    intro();
    (panel.querySelector("[data-step=start]") as HTMLElement | null)?.focus();
  };
  button.addEventListener("click", onButton);

  return {
    on: () => session !== null,
    state: () => (!session ? "off" : tracking ? "ok" : "on"),
    dispose() {
      button.removeEventListener("click", onButton);
      stop();
      dock.remove();
      panel.remove();
    },
  };
}
