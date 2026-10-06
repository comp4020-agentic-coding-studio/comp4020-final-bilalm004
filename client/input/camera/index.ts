import type { Hand, Level, SwingKind } from "../../../shared/games/tennis/sim.ts";
import { CameraError, openCamera, startPose } from "./camera.ts";
import type { CameraSession, CameraStats } from "./camera.ts";
import {
  CameraController,
  DEFAULT_CALIBRATION,
  MoveThrottle,
  DEFAULT_SWING,
  SwingDetector,
  bodyFrame,
  neutralFrom,
  thresholdsFrom,
  wrist,
} from "./pose.ts";
import type { AimMode, ArmPose, CameraFrame, Calibration, SwingMode } from "./pose.ts";

// Camera setup panel and play. Every step can be skipped, and any failure
// leaves the keyboard and buttons working with a message saying why.

export interface CameraCallbacks {
  /** Movement target on screen, -1..1. */
  move(target: number): void;
  /** Aim on screen, -1..1, as it was when the swing started. `lift` only in follow mode. */
  swing(level: Level, kind: SwingKind, aim: number, hand: Hand, lift?: number, timingAim?: boolean): void;
  /** The setup panel opened (true) or closed (false). */
  pause(paused: boolean): void;
}

export interface CameraInput {
  /** Live aim on screen while the camera is tracking, else null. */
  aim(): number | null;
  /** Level of the last camera swing. */
  level(): Level | null;
  /** Grip being held while tracking (palm to camera forehand, back of hand backhand), else null. */
  grip(): SwingKind | null;
  hand(): Hand;
  /** The racket arm to copy, in follow mode while tracking; else null. */
  arm(): ArmPose | null;
  mode(): SwingMode;
  aimMode(): AimMode;
  dispose(): void;
}

const STORAGE_KEY = "camera-calibration";
const SWINGS_PER_LEVEL = 2;
const LEVEL_WORDS = ["light", "medium", "hard"] as const;

function loadCalibration(): Calibration {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_CALIBRATION, ...(JSON.parse(raw) as Partial<Calibration>) };
  } catch {
    // storage unavailable or corrupt: use the defaults
  }
  return { ...DEFAULT_CALIBRATION };
}

function saveCalibration(c: Calibration): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    // storage unavailable: calibrate again next time
  }
}

export function createCameraInput(view: HTMLElement, button: HTMLButtonElement, chip: HTMLElement, cb: CameraCallbacks): CameraInput {
  const video = document.createElement("video");
  video.className = "selfview";
  video.hidden = true;
  video.setAttribute("aria-label", "Your camera preview, not sent anywhere");
  const panel = document.createElement("section");
  panel.className = "camera-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Camera setup");
  panel.hidden = true;
  view.append(video, panel);

  let calib = loadCalibration();
  let controller = new CameraController(calib);
  let session: CameraSession | null = null;
  let starting = false;
  let tracking = false;
  let stats: CameraStats | null = null;
  let aim: number | null = null;
  let arm: ArmPose | null = null;
  let grip: SwingKind | null = null;
  let lastLevel: Level | null = null;
  const moves = new MoveThrottle();
  // set while a calibration step wants the raw frames
  let capture: ((f: CameraFrame) => void) | null = null;

  const setChip = (text: string, state: "ok" | "warn" | "off") => {
    chip.hidden = false;
    chip.dataset.state = state;
    chip.textContent = text;
  };
  const refreshChip = () => {
    if (!session) return;
    if (tracking) setChip(`Tracking · ${grip ?? "forehand"} grip${stats ? ` · ${Math.round(stats.fps)} fps` : ""}`, "ok");
    else setChip("Can't see you", "warn");
  };

  const onFrame = (f: CameraFrame) => {
    const out = controller.update(f);
    const nextGrip = out.tracking ? out.grip : null;
    if (out.tracking !== tracking || nextGrip !== grip) {
      tracking = out.tracking;
      grip = nextGrip;
      video.dataset.tracking = String(tracking);
      refreshChip();
    }
    capture?.(f);
    aim = out.tracking ? out.aim : null;
    arm = out.tracking && calib.mode === "follow" ? out.arm : null;
    // no gameplay while calibrating
    if (capture || !panel.hidden) return;
    const target = moves.next(f.t, out.target);
    if (target !== null) cb.move(target);
    if (out.swing) {
      lastLevel = out.swing.level;
      cb.swing(out.swing.level, out.swing.kind, out.swing.aim, calib.hand, out.swing.lift, calib.aim === "timing" || undefined);
    }
  };

  const close = () => {
    capture = null;
    panel.hidden = true;
    view.classList.remove("calibrating");
    cb.pause(false);
    button.focus();
  };

  const stop = () => {
    session?.stop();
    session = null;
    moves.reset();
    tracking = false;
    aim = null;
    arm = null;
    grip = null;
    video.hidden = true;
    chip.hidden = true;
    button.textContent = "Camera";
  };

  const show = (html: string, actions: Record<string, () => void>) => {
    panel.innerHTML = html;
    if (panel.hidden) cb.pause(true);
    panel.hidden = false;
    view.classList.add("calibrating");
    for (const [name, fn] of Object.entries(actions)) {
      panel.querySelector(`[data-step=${name}]`)?.addEventListener("click", fn);
    }
    panel.querySelector<HTMLElement>("button.primary, button")?.focus();
  };

  const fail = (message: string) => {
    stop();
    setChip("Camera off", "off");
    show(
      `<h2>Camera unavailable</h2>
       <p role="alert"></p>
       <div class="row"><button class="primary" data-step="close">Keep playing</button></div>`,
      { close },
    );
    (panel.querySelector("[role=alert]") as HTMLElement).textContent = message;
  };

  const intro = () => {
    let hand: Hand = calib.hand;
    let mode: SwingMode = calib.mode;
    let aimMode: AimMode = calib.aim;
    show(
      `<h2>Play with your camera</h2>
       <p>Keep your head, shoulders and racket arm in view. Lean to move, point your racket hand to aim, swing to hit. Palm to the screen is a forehand, the back of your hand a backhand. The video stays on this device.</p>
       <div class="row" role="group" aria-label="Racket hand">
         <button data-hand="right">Right-handed</button>
         <button data-hand="left">Left-handed</button>
       </div>
       <div class="row" role="group" aria-label="Swing style">
         <button data-mode="follow" title="Your player copies your arm; the shot is when your hand sweeps through the ball">Follow my arm</button>
         <button data-mode="classic" title="A quick swing plays a stroke">Classic swing</button>
       </div>
       <div class="row" role="group" aria-label="Aim">
         <button data-aim="point" title="Point your racket hand where you want the ball to go, then swing">Aim by pointing</button>
         <button data-aim="timing" title="Hit early to go cross-court, late to go down the line">Aim by timing</button>
       </div>
       <div class="row">
         <button class="primary" data-step="start">Start camera</button>
         <button data-step="close">Cancel</button>
       </div>`,
      { start: () => start(hand, mode, aimMode), close },
    );
    const aimButtons = panel.querySelectorAll<HTMLButtonElement>("[data-aim]");
    const markAim = () => aimButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.aim === aimMode)));
    aimButtons.forEach((b) => b.addEventListener("click", () => ((aimMode = b.dataset.aim as AimMode), markAim())));
    markAim();
    const modeButtons = panel.querySelectorAll<HTMLButtonElement>("[data-mode]");
    const markMode = () => modeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
    modeButtons.forEach((b) => b.addEventListener("click", () => ((mode = b.dataset.mode as SwingMode), markMode())));
    markMode();
    const handButtons = panel.querySelectorAll<HTMLButtonElement>("[data-hand]");
    const mark = () => handButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.hand === hand)));
    handButtons.forEach((b) => b.addEventListener("click", () => ((hand = b.dataset.hand as Hand), mark())));
    mark();
  };

  const start = async (hand: Hand, mode: SwingMode, aimMode: AimMode) => {
    if (starting) return;
    starting = true;
    calib = { ...calib, hand, mode, aim: aimMode };
    controller = new CameraController(calib);
    show(`<h2>Starting camera…</h2><p class="muted" role="status">Waiting for permission.</p>`, {});
    try {
      const stream = await openCamera(video);
      video.hidden = false;
      show(`<h2>Loading pose model…</h2><p class="muted" role="status">The first time takes a few seconds.</p>`, {});
      setChip("Loading…", "warn");
      session = await startPose(video, stream, onFrame, (s) => ((stats = s), refreshChip()));
      button.textContent = "Stop camera";
      refreshChip();
      neutral();
    } catch (err) {
      fail(err instanceof CameraError ? err.message : "The camera didn't start. Keep playing with keys and buttons.");
    } finally {
      starting = false;
    }
  };

  const finish = () => {
    saveCalibration(calib);
    controller.setCalibration(calib);
    close();
  };

  const neutral = () => {
    show(
      `<h2>Stand neutral</h2>
       <p>Shoulders level, racket hand pointing at the screen. Hold still, then press Capture.</p>
       <p class="muted" role="status"></p>
       <div class="row">
         <button class="primary" data-step="capture">Capture</button>
         <button data-step="skip">Skip</button>
       </div>`,
      {
        capture: () => {
          const status = panel.querySelector("[role=status]") as HTMLElement;
          status.textContent = "Hold still…";
          const samples: { tilt: number; across: number }[] = [];
          const until = performance.now() + 1200;
          capture = (f) => {
            const frame = f.landmarks ? bodyFrame(f.landmarks, f.aspect) : null;
            const w = frame && f.landmarks ? wrist(f.landmarks, frame, calib.hand, f.aspect) : null;
            if (frame && w) samples.push({ tilt: frame.tilt, across: w.across });
            if (f.t < until) return;
            capture = null;
            const n = neutralFrom(samples);
            if (!n) {
              status.textContent = "Couldn't see your shoulders and racket hand. Try again or skip.";
              return;
            }
            calib = { ...calib, ...n };
            swings(0, { light: [], medium: [], hard: [] });
          };
        },
        skip: () => swings(0, { light: [], medium: [], hard: [] }),
      },
    );
  };

  const swings = (level: Level, peaks: { light: number[]; medium: number[]; hard: number[] }) => {
    const word = LEVEL_WORDS[level];
    const next = () => {
      capture = null;
      if (level < 2) swings((level + 1) as Level, peaks);
      else {
        calib = { ...calib, thresholds: thresholdsFrom(peaks) };
        finish();
      }
    };
    show(
      `<h2>Swing ${word}</h2>
       <p>Swing ${word} ${SWINGS_PER_LEVEL} times, the way you would to hit a ${word} shot.</p>
       <p class="muted" role="status">0 of ${SWINGS_PER_LEVEL}</p>
       <div class="row"><button data-step="skip">${level < 2 ? "Skip" : "Done"}</button></div>`,
      { skip: next },
    );
    const status = panel.querySelector("[role=status]") as HTMLElement;
    const detector = new SwingDetector(DEFAULT_SWING);
    capture = (f) => {
      const frame = f.landmarks ? bodyFrame(f.landmarks, f.aspect) : null;
      const w = frame && f.landmarks ? wrist(f.landmarks, frame, calib.hand, f.aspect) : null;
      if (!frame || !w) return detector.lose();
      const { swing } = detector.update(f.t, w);
      if (!swing) return;
      peaks[word].push(swing.peak);
      status.textContent = `${peaks[word].length} of ${SWINGS_PER_LEVEL}`;
      if (peaks[word].length >= SWINGS_PER_LEVEL) next();
    };
  };

  const onButton = () => {
    if (session) stop();
    else intro();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !panel.hidden && !starting) close();
  };
  button.addEventListener("click", onButton);
  window.addEventListener("keydown", onKey);

  return {
    aim: () => aim,
    level: () => lastLevel,
    grip: () => grip,
    hand: () => calib.hand,
    arm: () => arm,
    mode: () => calib.mode,
    aimMode: () => calib.aim,
    dispose() {
      button.removeEventListener("click", onButton);
      window.removeEventListener("keydown", onKey);
      stop();
      video.remove();
      panel.remove();
    },
  };
}
