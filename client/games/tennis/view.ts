import {
  AmbientLight,
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
  WebGLRenderer,
} from "three";
import { COURT, PLAYER, naturalKind, predictLanding, seatZ } from "../../../shared/games/tennis/sim.ts";
import type { Hand, Level, SwingKind, TennisSnapshot } from "../../../shared/games/tennis/sim.ts";
import type { RoomInfo, ServerMsg } from "../../../shared/protocol.ts";
import { createCameraInput } from "../../input/camera/index.ts";
import { createPlayInput } from "../../input/keyboard.ts";
import type { Connection } from "../../net/socket.ts";

const flat = (color: number) => new MeshLambertMaterial({ color, flatShading: true });

function makePlayer(color: number): { group: Group; racket: Mesh } {
  const group = new Group();
  const body = new Mesh(new CylinderGeometry(0.35, 0.45, 1.3, 6), flat(color));
  body.position.y = 0.65;
  const head = new Mesh(new IcosahedronGeometry(0.28, 0), flat(0xf1c9a5));
  head.position.y = 1.55;
  const racket = new Mesh(new BoxGeometry(0.08, 0.7, 0.45), flat(0xeeeeee));
  racket.position.set(0.55, 1.1, 0);
  group.add(body, head, racket);
  return { group, racket };
}

function buildCourt(scene: Scene): void {
  const ground = new Mesh(new PlaneGeometry(80, 80), flat(0x2f6b45));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  const court = new Mesh(new PlaneGeometry(COURT.halfW * 2 + 2, COURT.halfL * 2 + 6), flat(0x3b8f5a));
  court.rotation.x = -Math.PI / 2;
  scene.add(ground, court);

  const lineMat = new MeshBasicMaterial({ color: 0xffffff });
  const addLine = (w: number, d: number, x: number, z: number) => {
    const line = new Mesh(new BoxGeometry(w, 0.02, d), lineMat);
    line.position.set(x, 0.01, z);
    scene.add(line);
  };
  const L = COURT.halfL;
  const W = COURT.halfW;
  addLine(W * 2, 0.08, 0, L);
  addLine(W * 2, 0.08, 0, -L);
  addLine(0.08, L * 2, -W, 0);
  addLine(0.08, L * 2, W, 0);
  addLine(0.08, L * 2, 0, 0);

  const net = new Mesh(new BoxGeometry(W * 2 + 0.6, COURT.netH, 0.05), flat(0xf4f4f4));
  net.position.y = COURT.netH / 2;
  scene.add(net);
}

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
  scene.background = new Color(0x9fd4ff);
  scene.fog = new Fog(0x9fd4ff, 30, 70);
  scene.add(new AmbientLight(0xffffff, 1.6));
  const sun = new DirectionalLight(0xffffff, 2);
  sun.position.set(6, 12, 4);
  scene.add(sun);
  buildCourt(scene);

  const ball = new Mesh(new IcosahedronGeometry(0.22, 1), flat(0xe8ff3a));
  const shadow = new Mesh(new CircleGeometry(0.22, 10), new MeshBasicMaterial({ color: 0x000000, opacity: 0.3, transparent: true }));
  shadow.rotation.x = -Math.PI / 2;
  const players = [makePlayer(0x2f7fe0), makePlayer(0xe05a2f)] as const;
  players[0].group.position.z = seatZ(0) + 1.2;
  players[1].group.position.z = seatZ(1) - 1.2;
  players[1].group.rotation.y = Math.PI;
  scene.add(ball, shadow, players[0].group, players[1].group);

  // Where your next shot would land: a guide only, the server decides the hit.
  const reticleIn = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  const reticleOut = new MeshBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.85 });
  const reticle = new Mesh(new RingGeometry(0.35, 0.5, 20), reticleIn);
  reticle.rotation.x = -Math.PI / 2;
  reticle.visible = false;
  scene.add(reticle);

  const camera = new PerspectiveCamera(55, 1, 0.1, 120);
  const behindSeat1 = info.seat === 1;
  const camZ = (COURT.halfL + 9) * (behindSeat1 ? -1 : 1);
  camera.position.set(0, 5.5, camZ);
  camera.lookAt(0, 0, behindSeat1 ? 2 : -2);

  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = view;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 1 ? 88 : 55;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(view);
  resize();

  let snap: TennisSnapshot | null = null;
  let snapAt = performance.now();
  let names: [string | null, string | null] = [null, null];
  const swingAnim: [number, number] = [0, 0];
  const worldSign = behindSeat1 ? -1 : 1;
  let reticleLevel: Level = 1;

  const send = (level: Level, dirX: number, kind: SwingKind, hand?: Hand) => {
    if (info.seat === null) return;
    conn.send({ t: "swing", dirX, kind, level, hand });
    reticleLevel = level;
    swingAnim[info.seat] = performance.now();
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
    swing: (level, kind, aim, hand) => send(level, aim * worldSign, kind, hand),
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
    else statusEl.textContent = info.seat === null ? "Spectating" : snap.phase === "serve" ? "Get ready…" : "";
  };

  const unsubscribe = conn.on((msg: ServerMsg) => {
    if (msg.t === "state") {
      snap = msg.state as TennisSnapshot;
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
        const t = (now - swingAnim[seat]) / 220;
        p.racket.rotation.z = t < 1 ? -Math.sin(t * Math.PI) * 1.6 : 0;
      }
      const landing = info.seat === null ? null : predictLanding({ ...snap, rng: 0 }, currentAim(), reticleLevel);
      reticle.visible = landing !== null;
      if (landing) {
        reticle.position.set(landing.x, 0.03, landing.z);
        reticle.material = landing.in ? reticleIn : reticleOut;
      }
      canvas.dataset.reticle = landing ? `${landing.x.toFixed(2)},${landing.z.toFixed(2)},${landing.in ? "in" : "out"}` : "";
    }
    renderer.render(scene, camera);
    canvas.dataset.frames = String(++frames);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    unsubscribe();
    input.dispose();
    cameraInput.dispose();
    observer.disconnect();
    renderer.dispose();
  };
}
