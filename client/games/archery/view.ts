import {
  BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Line,
  LineDashedMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { AIM, MIN_DRAW, STAGES, SUDDEN_DEATH, TARGET, clampAim, predictHit, previewPath, scoreHit } from "../../../shared/games/archery/sim.ts";
import type { Aim, ArcherySnapshot, Seat, Shot } from "../../../shared/games/archery/sim.ts";
import type { LobbyView, RoomFormat, RoomInfo, ServerMsg } from "../../../shared/protocol.ts";
import type { GameLink } from "../../net/link.ts";
import { createReadyPanel } from "../tennis/ready-panel.ts";
import "./archery.css";
import { createBowCamera } from "./bow-camera.ts";
import { makeBow } from "./bow-model.ts";
import { RING_COLOURS, buildRange, makeTarget } from "./range.ts";

// The archery view (task 22), GamePigeon-style: you stand at the line looking
// down the range at the target. A dot shows where your arrow would land with
// no wind; the wind arrow shows what it will do instead. The server flies the
// arrow and scores it; this only draws what it says.

const FORMATS: readonly RoomFormat[] = ["stages", "unlimited"];
const SEAT_COLOURS = [0x2f7fe0, 0xe0453a] as const;
const SEAT_CSS = ["#2f7fe0", "#e0453a"] as const;
// mouse: this many pixels of drag back is a full draw
const DRAG_FULL_PX = 220;
// keys: radians per second of aim, draw per second
const KEY_AIM_RATE = 0.25;
const KEY_DRAW_RATE = 0.8;
// how often a changing sight is sent while drawing
const SEND_MS = 50;
// the camera's vertical field of view on a landscape screen, degrees
const LENS_DEG = 22;

/** Options for practice (task 22), which runs this view on a LocalLink. */
export interface ArcheryViewOptions {
  local?: boolean;
  leaveLabel?: string;
  /** The view's root, once built, so practice can add its own panel. */
  onView?(view: HTMLElement): void;
}

export function startArchery(root: HTMLElement, conn: GameLink, info: RoomInfo, onLeave: () => void, opts: ArcheryViewOptions = {}): () => void {
  const view = document.createElement("div");
  view.className = "game archery";
  view.innerHTML = `
    <canvas aria-label="Archery range"></canvas>
    <div class="hud">
      <div class="ar-score" aria-label="Score"></div>
      <div>
        <span class="muted code"></span>
        <span class="tracking" role="status" hidden></span>
        <button data-action="camera" hidden>Camera</button>
        <button data-action="copy">Copy invite</button>
        <button data-action="leave">Leave</button>
      </div>
      <div class="status" role="status"></div>
    </div>
    <div class="ar-side">
      <div class="ar-wind" role="img" aria-label="Wind">
        <svg viewBox="-50 -50 100 100" aria-hidden="true">
          <circle r="44" class="ar-wind-dial"/>
          <g class="ar-wind-arrow"><line x1="0" y1="26" x2="0" y2="-26"/><polygon points="0,-38 -11,-20 11,-20"/></g>
        </svg>
        <span class="ar-wind-text"></span>
      </div>
      <div class="ar-card" role="img" aria-label="Target"><svg viewBox="-1.1 -1.1 2.2 2.2" aria-hidden="true"></svg></div>
    </div>
    <div class="ar-call" aria-live="polite" hidden></div>
    <div class="ar-draw" aria-hidden="true"><span></span></div>
    <div class="controls" hidden>
      <button class="primary ar-shoot" type="button" aria-label="Hold to draw, release to shoot (Space)">Hold to draw</button>
    </div>
  `;
  root.replaceChildren(view);
  opts.onView?.(view);
  if (opts.local) {
    view.classList.add("local");
    for (const el of view.querySelectorAll<HTMLElement>(".code, [data-action=copy]")) el.hidden = true;
  }
  if (opts.leaveLabel) (view.querySelector("[data-action=leave]") as HTMLElement).textContent = opts.leaveLabel;

  const canvas = view.querySelector("canvas") as HTMLCanvasElement;
  const statusEl = view.querySelector(".status") as HTMLElement;
  const scoreEl = view.querySelector(".ar-score") as HTMLElement;
  const callEl = view.querySelector(".ar-call") as HTMLElement;
  const drawBar = view.querySelector(".ar-draw span") as HTMLElement;
  const windEl = view.querySelector(".ar-wind") as HTMLElement;
  const windArrow = view.querySelector(".ar-wind-arrow") as SVGGElement;
  const windText = view.querySelector(".ar-wind-text") as HTMLElement;
  const cardSvg = view.querySelector(".ar-card svg") as SVGSVGElement;
  (view.querySelector(".code") as HTMLElement).textContent = `Room ${info.room}`;
  canvas.dataset.frames = "0";

  // the 2D target card: rings once, arrows redrawn on every new shot
  const ringSvg = RING_COLOURS.map((c, i) => `<circle r="${1 - i / RING_COLOURS.length}" fill="#${c.toString(16).padStart(6, "0")}" stroke="#888" stroke-width=".004"/>`).join("");
  cardSvg.innerHTML = `<g>${ringSvg}</g><g class="ar-holes"></g><circle class="ar-card-sight" r=".05" hidden/>`;
  const holes = cardSvg.querySelector(".ar-holes") as SVGGElement;
  const cardSight = cardSvg.querySelector(".ar-card-sight") as SVGCircleElement;

  const scene = new Scene();
  const farthest = STAGES.at(-1)!.distance;
  buildRange(scene, farthest);
  const target = makeTarget();
  scene.add(target);

  // the sight on the face: where the arrow would land with no wind
  const sight = new Mesh(new RingGeometry(0.04, 0.07, 20), new MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
  sight.renderOrder = 10;
  scene.add(sight);
  const pathMat = new LineDashedMaterial({ color: 0xffffff, dashSize: 0.4, gapSize: 0.3, transparent: true, opacity: 0.7 });
  const path = new Line(new BufferGeometry(), pathMat);
  scene.add(path);

  const makeArrow = (colour: number) => {
    const g = new Group();
    const shaft = new Mesh(new CylinderGeometry(0.012, 0.012, 0.8, 5), new MeshLambertMaterial({ color: 0xd9b26f }));
    shaft.rotation.x = Math.PI / 2;
    const head = new Mesh(new ConeGeometry(0.025, 0.08, 5), new MeshLambertMaterial({ color: 0x555555 }));
    head.rotation.x = -Math.PI / 2;
    head.position.z = -0.44;
    const fletch = new Mesh(new ConeGeometry(0.04, 0.14, 3), new MeshLambertMaterial({ color: colour }));
    fletch.rotation.x = -Math.PI / 2;
    fletch.position.z = 0.36;
    g.add(shaft, head, fletch);
    return g;
  };
  const flying = makeArrow(0xffffff);
  flying.visible = false;
  scene.add(flying);
  // arrows stuck in the face this stage and the ones before at this distance
  const stuck = new Group();
  scene.add(stuck);
  const holeGeo = new CircleGeometry(0.025, 10);

  // a fixed lens: the board is big at 10 m and small at 50 m, as it should be
  // (the corner card shows it up close); wider on a tall phone screen
  const camera = new PerspectiveCamera(LENS_DEG, 1, 0.05, 400);
  // The shooter's bow, drawn over the range in its own scene with its own
  // wider lens, so it is the same size on screen whatever the range's lens.
  // Held upright just right of centre, the arrow pointing up the range.
  const bowScene = new Scene();
  bowScene.add(new HemisphereLight(0xdff2ff, 0x5a7a3a, 1.3));
  const bowLight = new DirectionalLight(0xffffff, 1.2);
  bowLight.position.set(1, 2, 2);
  bowScene.add(bowLight);
  const bowCamera = new PerspectiveCamera(50, 1, 0.01, 10);
  const bow = makeBow();
  bowScene.add(bow.group);
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const resize = () => {
    const { clientWidth: w, clientHeight: h } = view;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // keep the same width of view on a portrait screen
    camera.fov = camera.aspect < 1 ? Math.min(60, (2 * Math.atan(Math.tan((LENS_DEG * Math.PI) / 360) / camera.aspect) * 180) / Math.PI) : LENS_DEG;
    camera.updateProjectionMatrix();
    bowCamera.aspect = camera.aspect;
    bowCamera.fov = camera.aspect < 1 ? 70 : 50;
    bowCamera.updateProjectionMatrix();
    // lower right, clear of the target; a phone gets it a little further down
    // so the board (centre screen) stays clear
    bow.group.position.set(camera.aspect < 1 ? 0.2 : 0.42, camera.aspect < 1 ? -0.55 : -0.3, -2);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(view);
  resize();

  let snap: ArcherySnapshot | null = null;
  let names: [string | null, string | null] = [null, null];
  let lobby: LobbyView | null = null;
  const label = (seat: Seat) => (seat === info.seat ? "You" : (names[seat] ?? `Player ${seat + 1}`));
  const myTurn = () => snap !== null && info.seat !== null && snap.phase === "aim" && snap.turn === info.seat && playing();
  const playing = () => !lobby || info.practice || lobby.phase === "playing";

  // the shooter's own sight and draw, from the mouse, keys or camera
  let aim: Aim = { yaw: 0, pitch: 0.02, draw: 0 };
  let drawing = false;
  // when a held draw (Space, the button, the mouse) began: the draw is the
  // time held, so a slow frame rate can't make it weaker
  let heldSince: number | null = null;
  let lastSent = 0;
  const sendAim = (force = false) => {
    const now = performance.now();
    if (!force && now - lastSent < SEND_MS) return;
    lastSent = now;
    conn.send({ t: "aim", ...aim });
  };
  const release = () => {
    if (!drawing) return;
    drawing = false;
    if (heldSince !== null) aim = clampAim({ ...aim, draw: Math.max(aim.draw, ((performance.now() - heldSince) / 1000) * KEY_DRAW_RATE) });
    heldSince = null;
    if (myTurn() && aim.draw >= MIN_DRAW) conn.send({ t: "release", ...aim });
    else sendAim(true);
    aim = { ...aim, draw: 0 };
  };

  // Mouse and touch: move to aim, press and hold to draw (it grows while
  // held, faster if you drag back/down), let go to shoot. A test convenience
  // mostly; the camera is the way to play.
  let dragFrom: number | null = null;
  const aimAt = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
    return { yaw: nx * AIM.yaw, pitch: AIM.pitchMin + ((1 - ny) / 2) * (AIM.pitchMax - AIM.pitchMin) * 0.5 };
  };
  canvas.addEventListener("pointermove", (e) => {
    if (!myTurn() || bowCam.on()) return;
    if (dragFrom !== null) {
      // dragging back adds to the draw; the hold keeps growing it (frame loop)
      const pulled = (e.clientY - dragFrom) / DRAG_FULL_PX;
      if (pulled > 0) aim = clampAim({ ...aim, draw: Math.max(aim.draw, pulled) });
    } else aim = clampAim({ ...aim, ...aimAt(e) });
    sendAim();
  });
  canvas.addEventListener("pointerdown", (e) => {
    if (!myTurn() || bowCam.on()) return;
    canvas.setPointerCapture(e.pointerId);
    // a touch has no hover: aim where the finger lands
    if (e.pointerType !== "mouse") aim = clampAim({ ...aim, ...aimAt(e) });
    dragFrom = e.clientY;
    keys.add("Pointer");
    drawing = true;
    heldSince = performance.now();
  });
  const endDrag = () => {
    if (dragFrom === null) return;
    dragFrom = null;
    keys.delete("Pointer");
    release();
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", () => {
    dragFrom = null;
    keys.delete("Pointer");
    drawing = false;
    heldSince = null;
    aim = { ...aim, draw: 0 };
  });

  // Keys: arrows aim, hold Space to draw (the longer, the stronger), let go to shoot.
  const keys = new Set<string>();
  const onKey = (down: boolean) => (e: KeyboardEvent) => {
    // a focused button (the one that opened the game) mustn't swallow Space; a picker keeps its arrows
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(e.code)) return;
    if (e.code === "Space" && e.target instanceof HTMLButtonElement && !e.target.closest(".archery")) return;
    e.preventDefault();
    if (e.repeat) return;
    if (down) {
      if (e.code === "Space" && !keys.has("Space") && myTurn() && !bowCam.on()) {
        drawing = true;
        heldSince = performance.now();
      }
      keys.add(e.code);
    } else {
      keys.delete(e.code);
      if (e.code === "Space") release();
    }
  };
  const keydown = onKey(true);
  const keyup = onKey(false);
  window.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);

  // The on-screen button: hold to draw, the draw growing while held.
  const shootBtn = view.querySelector(".ar-shoot") as HTMLButtonElement;
  shootBtn.addEventListener("pointerdown", (e) => {
    if (!myTurn() || bowCam.on()) return;
    shootBtn.setPointerCapture(e.pointerId);
    keys.add("Button");
    drawing = true;
    heldSince = performance.now();
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    shootBtn.addEventListener(type, () => {
      if (!keys.delete("Button")) return;
      if (type === "pointerup") release();
      else {
        drawing = false;
        heldSince = null;
        aim = { ...aim, draw: 0 };
      }
    });
  }
  shootBtn.addEventListener("contextmenu", (e) => e.preventDefault());

  // The camera: bow hand aims, the other draws, a snap shoots.
  const cameraButton = view.querySelector("[data-action=camera]") as HTMLButtonElement;
  cameraButton.hidden = info.seat === null;
  const bowCam = createBowCamera(view, cameraButton, view.querySelector(".tracking") as HTMLElement, {
    aim: (a) => {
      if (!myTurn()) return;
      aim = clampAim(a);
      drawing = aim.draw > 0;
      sendAim();
    },
    release: (a) => {
      if (!myTurn()) return;
      aim = clampAim(a);
      drawing = true;
      release();
    },
    letdown: () => {
      drawing = false;
      aim = { ...aim, draw: 0 };
      if (myTurn()) sendAim(true);
    },
    pause: (p) => {
      if (info.practice) conn.send({ t: "pause", paused: p });
    },
  });

  const readyPanel = createReadyPanel(
    view,
    info.seat,
    info.room,
    {
      ready: (ready) => conn.send({ t: "ready", ready }),
      format: (format) => conn.send({ t: "format", format }),
      openCamera: () => cameraButton.click(),
    },
    FORMATS,
  );
  readyPanel.camera("off");
  const camTimer = window.setInterval(() => readyPanel.camera(bowCam.state()), 500);

  // the call after each arrow: "Bullseye!", "9", "Miss"
  let callTimer = 0;
  const call = (shot: Shot) => {
    const who = shot.seat === info.seat ? "" : `${label(shot.seat)}: `;
    callEl.textContent = shot.bullseye ? `${who}Bullseye!` : shot.points > 0 ? `${who}${shot.points}` : `${who}${shot.lost === "time" ? "Out of time" : "Miss"}`;
    callEl.dataset.points = String(shot.points);
    callEl.hidden = true;
    void callEl.offsetWidth;
    callEl.hidden = false;
    clearTimeout(callTimer);
    callTimer = window.setTimeout(() => (callEl.hidden = true), 1600);
  };

  const stageName = (s: ArcherySnapshot) =>
    opts.local
      ? `Practice · ${s.distance} m`
      : s.format === "unlimited" ? `Unlimited · ${s.distance} m` : s.stage === SUDDEN_DEATH ? `Sudden death · ${s.distance} m` : `Stage ${s.stage + 1} of ${STAGES.length} · ${s.distance} m`;

  const renderScore = (s: ArcherySnapshot) => {
    scoreEl.replaceChildren();
    const stage = document.createElement("div");
    stage.className = "ar-stage";
    stage.textContent = stageName(s);
    scoreEl.append(stage);
    // practice has one archer
    for (const seat of opts.local ? ([0] as const) : ([0, 1] as const)) {
      const row = document.createElement("div");
      row.className = "ar-row";
      row.dataset.seat = String(seat);
      row.dataset.turn = String(s.turn === seat && s.phase !== "over");
      row.style.setProperty("--seat", SEAT_CSS[seat]);
      const name = document.createElement("span");
      name.className = "ar-name";
      name.textContent = label(seat);
      const arrows = document.createElement("span");
      arrows.className = "ar-arrows";
      for (const sh of s.shots.filter((x) => x.seat === seat && x.stage !== SUDDEN_DEATH).slice(opts.local ? -5 : -8)) {
        const b = document.createElement("b");
        b.textContent = sh.bullseye ? "X" : String(sh.points);
        arrows.append(b);
      }
      const total = document.createElement("strong");
      total.className = "ar-total";
      total.textContent = opts.local ? `best ${s.best[seat]}` : String(s.totals[seat]);
      row.append(name, arrows, total);
      scoreEl.append(row);
    }
  };

  const renderWind = (s: ArcherySnapshot) => {
    const { speed, angle } = s.wind;
    windEl.dataset.speed = speed.toFixed(1);
    windEl.dataset.angle = String(Math.round((angle * 180) / Math.PI));
    // on the dial, right is right and up is downrange, as you see the range
    const deg = 90 - (angle * 180) / Math.PI;
    windArrow.setAttribute("transform", `rotate(${deg.toFixed(1)})`);
    windArrow.style.opacity = speed > 0 ? "1" : "0.15";
    windText.textContent = speed > 0 ? `${speed.toFixed(1)} m/s` : "No wind";
    const dir = ["right", "down-range right", "down-range", "down-range left", "left", "back-left", "back toward you", "back-right"][Math.round(((angle / (Math.PI * 2)) * 8) % 8 + 8) % 8];
    windEl.setAttribute("aria-label", speed > 0 ? `Wind ${speed.toFixed(1)} metres per second, blowing ${dir}` : "No wind");
  };

  const renderHoles = (s: ArcherySnapshot) => {
    // the card shows the shots at this stage's distance (both players)
    const here = s.shots.filter((sh) => sh.hit && sh.points > 0 && (s.format === "unlimited" ? true : sh.stage === s.stage || (s.phase === "result" && sh === s.shots.at(-1))));
    holes.innerHTML = here
      .slice(-12)
      .map((sh) => `<circle cx="${(sh.hit!.x / TARGET.radius).toFixed(3)}" cy="${(-sh.hit!.y / TARGET.radius).toFixed(3)}" r=".06" fill="${SEAT_CSS[sh.seat]}" stroke="#fff" stroke-width=".02"/>`)
      .join("");
    stuck.clear();
    for (const sh of s.shots.filter((x) => x.stage === s.stage && x.hit && x.points > 0)) {
      const a = makeArrow(SEAT_COLOURS[sh.seat]);
      a.position.set(sh.hit!.x, TARGET.centerY + sh.hit!.y, -s.distance + 0.3);
      const hole = new Mesh(holeGeo, new MeshBasicMaterial({ color: 0x111111 }));
      hole.position.set(sh.hit!.x, TARGET.centerY + sh.hit!.y, -s.distance + 0.03);
      stuck.add(a, hole);
    }
    canvas.dataset.shots = String(s.shots.length);
  };

  const updateHud = () => {
    if (!snap) return;
    const s = snap;
    renderScore(s);
    const l = lobby;
    view.dataset.phase = l?.phase ?? "";
    view.dataset.turn = myTurn() ? "mine" : "";
    shootBtn.disabled = !myTurn();
    if (l?.phase === "paused" && l.hold) {
      statusEl.textContent = `Paused: waiting for ${l.hold.seat === info.seat ? "you" : l.hold.name} to reconnect (${l.hold.seconds} s)`;
    } else if (l?.match && l.phase === "countdown") statusEl.textContent = `Back. Resuming in ${l.countdown ?? 0}…`;
    else if (s.phase === "over" && s.winner !== null) {
      const w = s.winner;
      const score = `${s.totals[w]} to ${s.totals[w === 0 ? 1 : 0]}`;
      statusEl.textContent = w === info.seat ? `You win, ${score}!` : `${label(w)} wins, ${score}`;
    }
    else if (l && !info.practice && l.phase !== "playing") statusEl.textContent = "";
    else if (l?.tally) statusEl.textContent = `Unlimited · best arrow ${l.tally.bestRally}`;
    else if (s.phase === "aim") statusEl.textContent = myTurn() ? "Your shot: aim, draw, let go" : `${label(s.turn)} is aiming…`;
    else statusEl.textContent = "";
  };

  const unsubscribe = conn.on((msg: ServerMsg) => {
    if (msg.t === "state") {
      const next = msg.state as ArcherySnapshot;
      const prev = snap;
      if (!prev || prev.shots.length !== next.shots.length || prev.stage !== next.stage || prev.matches !== next.matches) {
        const newest = next.shots.at(-1);
        if (prev && newest && next.shots.length > prev.shots.length) call(newest);
        renderHoles(next);
      }
      // a new turn of mine: start from a straight, undrawn sight
      if (next.phase === "aim" && next.turn === info.seat && (prev?.phase !== "aim" || prev.turn !== next.turn)) {
        aim = { yaw: 0, pitch: 0.02, draw: 0 };
        drawing = false;
      }
      snap = next;
      renderWind(next);
      updateHud();
    } else if (msg.t === "presence") {
      names = msg.names;
      updateHud();
    } else if (msg.t === "lobby") {
      const { t: _t, ...v } = msg;
      lobby = v;
      readyPanel.update(v);
      updateHud();
    }
  });

  view.querySelector("[data-action=leave]")?.addEventListener("click", onLeave);
  view.querySelector("[data-action=copy]")?.addEventListener("click", (e) => {
    const button = e.currentTarget as HTMLButtonElement;
    navigator.clipboard
      ?.writeText(`${location.origin}/#/room/${info.room}`)
      .then(() => (button.textContent = "Copied"))
      .catch(() => (button.textContent = "Copy failed"));
  });
  (view.querySelector(".controls") as HTMLElement).hidden = info.seat === null;

  let frames = 0;
  let raf = 0;
  let last = performance.now();
  const eye = new Vector3();
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (snap) {
      const s = snap;
      // keys and the hold button: aim and draw grow while held
      if (myTurn() && !bowCam.on()) {
        const dy = (keys.has("ArrowUp") ? 1 : 0) - (keys.has("ArrowDown") ? 1 : 0);
        const dx = (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0);
        const holding = drawing && (keys.has("Space") || keys.has("Button") || keys.has("Pointer"));
        if (dx || dy || holding) {
          const held = heldSince === null ? 0 : ((now - heldSince) / 1000) * KEY_DRAW_RATE;
          aim = clampAim({ yaw: aim.yaw + dx * KEY_AIM_RATE * dt, pitch: aim.pitch + dy * KEY_AIM_RATE * dt, draw: holding ? Math.max(aim.draw, held) : aim.draw });
          sendAim();
        }
      }
      target.position.set(0, TARGET.centerY, -s.distance);
      // first person at the line, straight down the middle: just behind and
      // above where the arrow leaves the bow (x 0), so it flies from the centre
      eye.set(0, 1.75, 1.2);
      camera.position.copy(eye);
      camera.lookAt(0, TARGET.centerY, -s.distance);

      // the sight: mine while I aim, the shooter's (as sent) while I watch
      const shownAim = myTurn() ? aim : s.aim;
      const aiming = s.phase === "aim" && (myTurn() || shownAim.draw > 0 || s.aim.yaw !== 0 || s.aim.pitch !== 0);
      const hit = aiming ? predictHit({ ...shownAim, draw: Math.max(shownAim.draw, MIN_DRAW) }, s.distance) : null;
      sight.visible = hit !== null;
      cardSight.toggleAttribute("hidden", hit === null);
      if (hit) {
        sight.position.set(hit.x, TARGET.centerY + hit.y, -s.distance + 0.05);
        const sc = Math.max(1, s.distance / 15);
        sight.scale.setScalar(sc);
        (sight.material as MeshBasicMaterial).color.setHex(s.turn === info.seat ? 0xffffff : SEAT_COLOURS[s.turn]);
        cardSight.setAttribute("cx", (hit.x / TARGET.radius).toFixed(3));
        cardSight.setAttribute("cy", (-hit.y / TARGET.radius).toFixed(3));
        cardSight.setAttribute("stroke", s.turn === info.seat ? "#fff" : SEAT_CSS[s.turn]);
        canvas.dataset.preview = `${hit.x.toFixed(3)},${hit.y.toFixed(3)},${scoreHit(hit).points}`;
      } else canvas.dataset.preview = "";
      // the no-wind arc, only while drawn, for whoever is shooting
      if (aiming && shownAim.draw >= MIN_DRAW) {
        const pts = previewPath(shownAim, s.distance, 4).map((p) => new Vector3(p.x, p.y, p.z));
        path.geometry.setFromPoints(pts);
        path.computeLineDistances();
        path.visible = true;
      } else path.visible = false;

      drawBar.style.width = `${Math.round((myTurn() ? aim.draw : s.phase === "aim" ? s.aim.draw : 0) * 100)}%`;
      drawBar.parentElement!.dataset.ready = String((myTurn() ? aim.draw : 0) >= MIN_DRAW);
      canvas.dataset.draw = (myTurn() ? aim.draw : s.aim.draw).toFixed(2);

      // the bow: drawn as far as the shooter's draw, an arrow on it while aiming,
      // and turned a little toward where the sight is
      const bowDraw = s.phase === "aim" ? shownAim.draw : 0;
      bow.set(bowDraw, s.phase === "aim");
      // the arrow points at the centre of the screen (where the range goes),
      // plus a little of the aim; canted a touch like a real archer
      const p = bow.group.position;
      bow.group.rotation.set(Math.atan2(-p.y, -p.z) + shownAim.pitch * 0.4, Math.atan2(p.x, -p.z) - shownAim.yaw * 0.4, -0.1, "YXZ");
      canvas.dataset.bow = bowDraw.toFixed(2);

      flying.visible = s.phase === "flight" && s.arrow !== null;
      if (s.arrow && flying.visible) {
        const { pos, vel } = s.arrow;
        flying.position.set(pos.x, pos.y, pos.z);
        flying.lookAt(pos.x - vel.x, pos.y - vel.y, pos.z - vel.z);
      }
      canvas.dataset.phase = s.phase;
      canvas.dataset.turn = String(s.turn);
      canvas.dataset.distance = String(s.distance);
    }
    renderer.autoClear = true;
    renderer.render(scene, camera);
    // the bow on top: keep the range, clear only depth
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(bowScene, bowCamera);
    canvas.dataset.frames = String(++frames);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(callTimer);
    clearInterval(camTimer);
    readyPanel.dispose();
    unsubscribe();
    window.removeEventListener("keydown", keydown);
    window.removeEventListener("keyup", keyup);
    bowCam.dispose();
    observer.disconnect();
    renderer.dispose();
  };
}
