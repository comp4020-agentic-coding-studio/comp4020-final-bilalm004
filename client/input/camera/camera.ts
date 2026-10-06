import type { CameraFrame } from "./pose.ts";

// Webcam plus MediaPipe pose. The video stays in this browser: frames go to
// the pose model running locally, and only the landmarks come out. The model
// and its runtime are downloaded the first time a player picks the camera.

const MEDIAPIPE_VERSION = "1.0.1";
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const LOAD_TIMEOUT_MS = 30_000;
// a phone runs detection and the 3D renderer together; leave it room
const DETECT_INTERVAL_MS = matchMedia("(pointer: coarse)").matches ? 66 : 33;

export class CameraError extends Error {}

export interface CameraStats {
  /** detections per second over the last second */
  fps: number;
  /** average time spent in the pose model per frame, ms */
  detectMs: number;
}

export interface CameraSession {
  stop(): void;
}

function explain(err: unknown): CameraError {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return new CameraError("Camera blocked. Allow it in the browser's site settings, or keep playing with keys and buttons.");
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return new CameraError("No camera found. Keep playing with keys and buttons.");
  if (name === "NotReadableError") return new CameraError("The camera is in use by another app. Keep playing with keys and buttons.");
  return new CameraError("The camera didn't start. Keep playing with keys and buttons.");
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new CameraError(message)), ms);
    p.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e)),
    );
  });
}

/** Asks for the camera. Rejects with a CameraError the player can read. */
export async function openCamera(video: HTMLVideoElement): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError("This browser can't use a camera here. Keep playing with keys and buttons.");
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
  } catch (err) {
    throw explain(err);
  }
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play().catch(() => undefined);
  return stream;
}

/** Loads the pose model and runs it on the video until stopped. */
export async function startPose(
  video: HTMLVideoElement,
  stream: MediaStream,
  onFrame: (f: CameraFrame) => void,
  onStats: (s: CameraStats) => void,
): Promise<CameraSession> {
  let landmarker: import("@mediapipe/tasks-vision").PoseLandmarker;
  try {
    landmarker = await withTimeout(
      (async () => {
        const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
        const files = await FilesetResolver.forVisionTasks(WASM_URL);
        const options = (delegate: "GPU" | "CPU") => ({
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          runningMode: "VIDEO" as const,
          numPoses: 1,
        });
        return PoseLandmarker.createFromOptions(files, options("GPU")).catch(() =>
          PoseLandmarker.createFromOptions(files, options("CPU")),
        );
      })(),
      LOAD_TIMEOUT_MS,
      "The pose model took too long to load.",
    );
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    throw err instanceof CameraError
      ? new CameraError(`${err.message} Keep playing with keys and buttons.`)
      : new CameraError("The pose model didn't load. Keep playing with keys and buttons.");
  }

  let raf = 0;
  let stopped = false;
  let lastDetect = 0;
  let lastVideoTime = -1;
  let windowStart = performance.now();
  let count = 0;
  let spent = 0;

  const loop = (now: number) => {
    if (stopped) return;
    raf = requestAnimationFrame(loop);
    if (now - lastDetect < DETECT_INTERVAL_MS || video.readyState < 2 || video.currentTime === lastVideoTime) return;
    lastDetect = now;
    lastVideoTime = video.currentTime;
    const t0 = performance.now();
    const result = landmarker.detectForVideo(video, now);
    spent += performance.now() - t0;
    count++;
    onFrame({ t: now, landmarks: result.landmarks[0] ?? null, aspect: video.videoWidth / video.videoHeight });
    if (now - windowStart >= 1000) {
      onStats({ fps: (count * 1000) / (now - windowStart), detectMs: spent / count });
      windowStart = now;
      count = 0;
      spent = 0;
    }
  };
  raf = requestAnimationFrame(loop);

  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      landmarker.close();
    },
  };
}
