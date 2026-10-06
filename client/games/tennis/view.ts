import {
  CircleGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  SphereGeometry,
  WebGLRenderer,
} from "three";
import { COURT, LEVEL_NAMES, PLAYER, naturalKind, predictLanding, seatZ, swingTiming } from "../../../shared/games/tennis/sim.ts";
import type { Hand, Level, SwingKind, TennisSnapshot } from "../../../shared/games/tennis/sim.ts";
import type { RoomInfo, ServerMsg } from "../../../shared/protocol.ts";
import { createCameraInput } from "../../input/camera/index.ts";
import { createPlayInput } from "../../input/keyboard.ts";
import type { Connection } from "../../net/socket.ts";
import { makePlayer } from "./character.ts";
import { buildStadium } from "./stadium.ts";

// where the reticle sits for a shot that won't clear the net
const NET_MARK_Z = 0.8;

// how long a stroke animation lasts
const SWING_MS = 320;

export function startTennis(root: HTMLElement, conn: Connection, info: RoomInfo, onLeave: () => void): () => void {
  const view = document.createElement("div");
  view.className = "game";
  view.innerHTML = `
    <canvas aria-label="Tennis court"></canvas>
    <div class="hud">
      <div class="score" aria-live="polite"></div>
      <div>
        <span class="muted code"></span>
        <span class="tracking" role="status" hidden></span>
        <button data-action="camera" hidden>Camera</button>
        <button data-action="copy">Copy invite</button>
        <button data-action="leave">Leave</button>
      </div>
      <div class="status" role="status"></div>
    </div>
    <div class="stroke" aria-live="polite"></div>
    <div class="controls" hidden>
      <button class="move" data-move="-1" aria-label="Move left (A)">◀</button>
      <button class="primary" data-level="0" aria-label="Light swing (1)">Light</button>
      <button class="primary" data-level="1" aria-label="Medium swing (Space)">Medium</button>
      <button class="primary" data-level="2" aria-label="Hard swing (3)">Hard</button>
      <button class="move" data-move="1" aria-label="Move right (D)">▶</button>
    </div>
  `;
  root.replaceChildren(view);

  const canvas = view.querySelector("canvas") as HTMLCanvasElement;
  const scoreEl = view.querySelector(".score") as HTMLElement;
  const statusEl = view.querySelector(".status") as HTMLElement;
  const codeEl = view.querySelector(".code") as HTMLElement;
  codeEl.textContent = `Room ${info.room}`;
  canvas.dataset.frames = "0";

  const scene = new Scene();
  buildStadium(scene);

  const ball = new Mesh(new SphereGeometry(0.2, 14, 10), new MeshLambertMaterial({ color: 0xffd426, emissive: 0x4a3a00 }));
  const shadow = new Mesh(new CircleGeometry(0.22, 12), new MeshBasicMaterial({ color: 0x000000, opacity: 0.35, transparent: true }));
  shadow.rotation.x = -Math.PI / 2;
  // a clearly different top for each seat
  const players = [makePlayer(0x2f7fe0, 0x4a2c1a, 0x2a6fd6), makePlayer(0xe0453a, 0x1d1b1a, 0xe08a1a)] as const;
  players[0].group.position.z = seatZ(0) + 0.8;
  players[1].group.position.z = seatZ(1) - 0.8;
  players[1].group.rotation.y = Math.PI;
  scene.add(ball, shadow, players[0].group, players[1].group);

  // Where your next shot would land, always on the opponent's half: a guide
  // only, the server decides the hit. Faint when it's from aim alone.
  const reticleIn = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  const reticleOut = new MeshBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.85 });
  const reticle = new Mesh(new RingGeometry(0.5, 0.75, 24), reticleIn);
  reticle.rotation.x = -Math.PI / 2;
  reticle.visible = false;
  scene.add(reticle);

  const camera = new PerspectiveCamera(55, 1, 0.1, 120);
  const behindSeat1 = info.seat === 1;
  // raised and behind the near player, looking down the court at about 30 degrees
  const behind = behindSeat1 ? -1 : 1;
  camera.position.set(0, 9, (COURT.halfL + 11) * behind);
  camera.lookAt(0, 0, 1 * behind);

  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = view;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 1 ? 72 : 50;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(view);
  resize();

  let snap: TennisSnapshot | null = null;
  let snapAt = performance.now();
  let names: [string | null, string | null] = [null, null];
  const swingAnim: [number, number] = [0, 0];
  // racket on the right-hand side (1) or left (-1), and whether the swing is a backhand
  const strokeAnim: [{ side: 1 | -1; backhand: boolean }, { side: 1 | -1; backhand: boolean }] = [
    { side: 1, backhand: false },
    { side: 1, backhand: false },
  ];
  const strokeEl = view.querySelector(".stroke") as HTMLElement;
  let strokeTimer = 0;
  const showStroke = (kind: SwingKind, level: Level, note: string) => {
    strokeEl.textContent = `${kind === "forehand" ? "Forehand" : "Backhand"} · ${LEVEL_NAMES[level]}${note}`;
    strokeEl.dataset.sent = String(note === "");
    clearTimeout(strokeTimer);
    strokeTimer = window.setTimeout(() => (strokeEl.textContent = ""), 1200);
  };
  const animate = (kind: SwingKind, hand: Hand = "right") => {
    if (info.seat === null) return;
    strokeAnim[info.seat] = { side: hand === "right" ? 1 : -1, backhand: kind === "backhand" };
    swingAnim[info.seat] = performance.now();
  };
  const worldSign = behindSeat1 ? -1 : 1;
  let reticleLevel: Level = 1;
  let paused = false;

  const send = (level: Level, dirX: number, kind: SwingKind, hand?: Hand) => {
    if (info.seat === null) return;
    conn.send({ t: "swing", dirX, kind, level, hand });
    reticleLevel = level;
    animate(kind, hand);
    showStroke(kind, level, "");
  };
  // Keys and buttons have no forehand/backhand, so they use the one that suits the ball.
  const swing = (level: Level, dirX: number) => {
    if (info.seat === null) return;
    const me = snap?.players[info.seat].x ?? 0;
    send(level, dirX, naturalKind(info.seat, me, snap?.ball.x ?? me));
  };
  // Hold: walk toward the sideline. Release: stop where the server last had us.
  const move = (dir: -1 | 0 | 1) => {
    if (info.seat === null) return;
    const x = dir === 0 ? (snap?.players[info.seat].x ?? 0) : dir * (COURT.halfW + PLAYER.sideRoom);
    conn.send({ t: "move", x });
  };
  const input = createPlayInput(canvas, worldSign, { move, swing });

  const cameraButton = view.querySelector("[data-action=camera]") as HTMLButtonElement;
  cameraButton.hidden = info.seat === null;
  const cameraInput = createCameraInput(view, cameraButton, view.querySelector(".tracking") as HTMLElement, {
    move: (target) => {
      if (info.seat !== null) conn.send({ t: "move", x: target * worldSign * (COURT.halfW + PLAYER.sideRoom) });
    },
    // Only a swing as the ball arrives is sent: an earlier one is a wind-up
    // (taking the racket back before a backhand looks like a forehand).
    swing: (level, kind, aim, hand) => {
      if (info.seat === null) return;
      const timing = snap ? swingTiming({ ...snap, rng: 0 }, info.seat) : "none";
      if (timing === "ready") return send(level, aim * worldSign, kind, hand);
      animate(kind, hand);
      showStroke(kind, level, timing === "early" ? " · too early, not sent" : " · no ball to hit");
    },
    pause: (p) => {
      if (!info.practice) return;
      paused = p;
      conn.send({ t: "pause", paused: p });
      updateHud();
    },
  });
  const currentAim = () => {
    const cam = cameraInput.aim();
    return cam !== null ? cam * worldSign : input.aim();
  };

  const label = (seat: 0 | 1) => (seat === info.seat ? "You" : (names[seat] ?? `Player ${seat + 1}`));

  const updateHud = () => {
    if (!snap) return;
    scoreEl.textContent = `${label(0)} ${snap.score[0]} – ${snap.score[1]} ${label(1)}`;
    if (snap.phase === "over") statusEl.textContent = snap.winner === info.seat ? "You win!" : `${label(snap.winner as 0 | 1)} wins`;
    else if (!info.practice && (names[0] === null || names[1] === null)) statusEl.textContent = `Waiting for an opponent. Share code ${info.room}`;
    else if (paused) statusEl.textContent = "Paused while you set up the camera";
    else statusEl.textContent = info.seat === null ? "Spectating" : snap.phase === "serve" ? "Get ready…" : "";
  };

  const unsubscribe = conn.on((msg: ServerMsg) => {
    if (msg.t === "state") {
      const next = msg.state as TennisSnapshot;
      // the opponent (or bot) just hit: show their stroke, mid-swing at contact
      const hitter = next.lastHitter;
      if (snap && hitter !== null && hitter !== snap.lastHitter && hitter !== info.seat) {
        const x = next.players[hitter].x;
        strokeAnim[hitter] = { side: 1, backhand: naturalKind(hitter, x, next.ball.x) === "backhand" };
        swingAnim[hitter] = performance.now() - SWING_MS * 0.45;
      }
      snap = next;
      snapAt = performance.now();
      updateHud();
    } else if (msg.t === "presence") {
      names = msg.names;
      updateHud();
    }
  });

  const controls = view.querySelector(".controls") as HTMLElement;
  controls.hidden = info.seat === null;
  for (const button of controls.querySelectorAll<HTMLButtonElement>("[data-level]")) {
    button.addEventListener("click", () => swing(Number(button.dataset.level) as Level, currentAim()));
  }
  for (const button of controls.querySelectorAll<HTMLButtonElement>("[data-move]")) {
    const dir = Number(button.dataset.move) as -1 | 1;
    button.addEventListener("pointerdown", (e) => {
      button.setPointerCapture(e.pointerId);
      input.holdMove(dir, true);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      button.addEventListener(type, () => input.holdMove(dir, false));
    }
    button.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  view.querySelector("[data-action=leave]")?.addEventListener("click", onLeave);
  view.querySelector("[data-action=copy]")?.addEventListener("click", (e) => {
    const button = e.currentTarget as HTMLButtonElement;
    navigator.clipboard
      ?.writeText(`${location.origin}/#/room/${info.room}`)
      .then(() => (button.textContent = "Copied"))
      .catch(() => (button.textContent = "Copy failed"));
  });

  let frames = 0;
  let raf = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (snap) {
      const e = Math.min((now - snapAt) / 1000, 0.15);
      const b = snap.ball;
      const x = b.x + b.vx * e;
      const y = Math.max(0, b.y + b.vy * e - 0.5 * COURT.gravity * e * e);
      const z = b.z + b.vz * e;
      ball.position.set(x, y, z);
      shadow.position.set(x, 0.02, z);
      shadow.scale.setScalar(Math.max(0.4, 1.2 - y * 0.15));
      for (const seat of [0, 1] as const) {
        const p = players[seat];
        p.group.position.x += (snap.players[seat].x - p.group.position.x) * 0.3;
        const t = (now - swingAnim[seat]) / SWING_MS;
        const { side, backhand } = strokeAnim[seat];
        if (t < 1) p.pose(t, backhand, side);
        else {
          // between swings, your avatar holds the racket the way your camera grip is turned
          const grip = seat === info.seat ? cameraInput.grip() : null;
          const aim = seat === info.seat ? (cameraInput.aim() ?? input.aim() * worldSign) : 0;
          p.pose(null, grip === "backhand", grip ? (cameraInput.hand() === "right" ? 1 : -1) : side, aim);
        }
      }
      const landing =
        info.seat === null || snap.phase === "over"
          ? null
          : predictLanding({ ...snap, rng: 0 }, info.seat, currentAim(), reticleLevel, cameraInput.hand(), cameraInput.grip() ?? undefined);
      reticle.visible = landing !== null;
      if (landing && info.seat !== null) {
        // into the net or onto your own side: show it red just over the net, on their side
        const farSign = info.seat === 0 ? -1 : 1;
        const z = landing.farSide ? landing.z : farSign * NET_MARK_Z;
        const material = landing.in ? reticleIn : reticleOut;
        material.opacity = landing.predicted ? 0.95 : 0.6;
        reticle.position.set(landing.x, 0.03, z);
        reticle.material = material;
        canvas.dataset.reticle = `${landing.x.toFixed(2)},${z.toFixed(2)},${landing.in ? "in" : "out"},${landing.predicted ? "ball" : "aim"}`;
      } else canvas.dataset.reticle = "";
    }
    renderer.render(scene, camera);
    canvas.dataset.frames = String(++frames);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(strokeTimer);
    unsubscribe();
    input.dispose();
    cameraInput.dispose();
    observer.disconnect();
    renderer.dispose();
  };
}
