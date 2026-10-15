import { Mesh, MeshBasicMaterial, RingGeometry } from "three";
import type { Scene } from "three";
import "./training.css";
import { LESSONS, MOVEMENT_OFFER, REQUIRED_LESSONS, TARGET_RADIUS, afterLesson, missFeedback, shotFeedback, trainingComplete } from "./lessons.ts";
import type { LessonId } from "./lessons.ts";
import { LocalLink } from "./local-link.ts";
import { TrainingSim } from "./training-sim.ts";
import type { TrainingEvent } from "./training-sim.ts";
import { startTennis } from "./view.ts";

// Training mode (task 5): the camera's way in. The tennis view runs against a
// LocalLink, a sim in the page with a ball machine for an opponent: no
// server room, no score, nothing sent over the network. A coach panel walks
// through the steps; each completes from what the player actually does.

// a finished step stays up this long before the next one starts
const NEXT_MS = 1400;

export function startTraining(root: HTMLElement, onExit: () => void): () => void {
  const sim = new TrainingSim((Math.random() * 2 ** 32) >>> 0);
  const link = new LocalLink(sim);
  let scene: Scene | null = null;
  const stopView = startTennis(root, link, { room: "TRAIN", game: "tennis", seat: 0, practice: true }, onExit, {
    local: true,
    leaveLabel: "Skip training",
    onScene: (s) => (scene = s),
  });
  const view = root.querySelector(".game") as HTMLElement;
  view.classList.add("training");
  const canvas = view.querySelector("canvas") as HTMLCanvasElement;
  const cameraButton = view.querySelector("[data-action=camera]") as HTMLButtonElement;

  // where your last shot landed, and the optional step's target
  const landMat = new MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.95, depthWrite: false });
  const landMark = new Mesh(new RingGeometry(0.3, 0.55, 28), landMat);
  landMark.rotation.x = -Math.PI / 2;
  landMark.visible = false;
  const targetMark = new Mesh(
    new RingGeometry(TARGET_RADIUS - 0.18, TARGET_RADIUS, 40),
    new MeshBasicMaterial({ color: 0x4dd8ff, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  targetMark.rotation.x = -Math.PI / 2;
  targetMark.visible = false;
  (scene as Scene | null)?.add(landMark, targetMark);

  const coach = document.createElement("section");
  coach.className = "coach";
  coach.setAttribute("aria-label", "Training");
  coach.innerHTML = `
    <p class="coach-step"></p>
    <h2 class="coach-title"></h2>
    <p class="coach-how"></p>
    <details class="coach-why" hidden><summary>Why?</summary><p></p></details>
    <p class="coach-progress" role="status"></p>
    <p class="coach-feedback" aria-live="polite"></p>
    <div class="coach-row"></div>`;
  view.append(coach);
  // The HUD wraps to more rows on a phone once the camera is on (the tracking
  // chip, "Stop camera"), so the coach and the camera dock sit under its
  // measured bottom rather than a fixed offset.
  const hud = view.querySelector(".hud") as HTMLElement;
  const placeBelowHud = () => {
    view.style.setProperty("--hud-bottom", `${Math.ceil(hud.getBoundingClientRect().bottom)}px`);
    view.style.setProperty("--coach-bottom", `${Math.ceil(coach.getBoundingClientRect().bottom)}px`);
  };
  const hudObserver = new ResizeObserver(placeBelowHud);
  hudObserver.observe(hud);
  hudObserver.observe(coach);
  placeBelowHud();
  const el =(c: string) => coach.querySelector(`.${c}`) as HTMLElement;
  const row = el("coach-row");

  let current: LessonId | null = null;
  let nextTimer = 0;
  const done = new Set<LessonId>();

  const buttons = (list: [string, string, () => void, boolean?][]) => {
    row.replaceChildren(
      ...list.map(([label, id, fn, primary]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.dataset.coach = id;
        if (primary) b.className = "primary";
        b.addEventListener("click", () => {
          // keep Space for swinging: a focused button would take it
          b.blur();
          fn();
        });
        return b;
      }),
    );
  };

  const setText = (step: string, title: string, how: string) => {
    el("coach-step").textContent = step;
    el("coach-title").textContent = title;
    el("coach-how").textContent = how;
    el("coach-progress").textContent = "";
  };

  const feedback = (text: string, kind: "hit" | "miss" | "") => {
    const f = el("coach-feedback");
    f.textContent = text;
    f.dataset.kind = kind;
  };

  const why = el("coach-why") as HTMLDetailsElement;
  const setWhy = (text: string | undefined) => {
    why.hidden = !text;
    why.open = false;
    (why.querySelector("p") as HTMLElement).textContent = text ?? "";
  };

  // between steps: no lesson running, so the machine just keeps feeding gently
  const idle = (lesson: string) => {
    current = null;
    coach.dataset.lesson = lesson;
    coach.dataset.done = "false";
    sim.setLesson("targets");
    targetMark.visible = false;
    setWhy(undefined);
  };

  const finish = () => {
    idle("done");
    setText(
      trainingComplete(done) ? "Training complete" : "Training over",
      "You're ready to play",
      "Auto-move stays on in games (switch it under the camera preview). Practise against the bot or play a friend from the lobby.",
    );
    const extras: [string, string, () => void][] = [];
    if (!done.has("movement")) extras.push(["Practise moving", "movement", () => begin("movement")]);
    if (!done.has("targets")) extras.push(["Try targets", "targets", () => begin("targets")]);
    buttons([["Go to the lobby", "lobby", onExit, true], ...extras]);
  };

  // user's call: auto-move is on throughout; moving yourself is offered, not required
  const offerMovement = () => {
    idle("offer");
    setText("Optional", MOVEMENT_OFFER.question, "Training is complete either way. The drill starts you near the sideline and sends the ball to the other side.");
    buttons([
      [MOVEMENT_OFFER.yes, "yes", () => begin("movement"), true],
      [MOVEMENT_OFFER.no, "no", finish],
    ]);
  };

  const nextAfter = (id: LessonId) => {
    const after = afterLesson(id);
    if ("next" in after) begin(after.next);
    else if ("offer" in after) offerMovement();
    else finish();
  };

  const begin = (id: LessonId) => {
    clearTimeout(nextTimer);
    current = id;
    const lesson = LESSONS.find((l) => l.id === id)!;
    const n = REQUIRED_LESSONS.findIndex((l) => l.id === id);
    setText(n >= 0 ? `Step ${n + 1} of ${REQUIRED_LESSONS.length}` : "Extra", lesson.title, lesson.how);
    setWhy(lesson.why);
    coach.dataset.lesson = id;
    coach.dataset.done = "false";
    const events = sim.setLesson(id);
    // only this step's feeds count (for the e2e)
    canvas.dataset.trainFeed = "";
    link.emitTraining(events);
    targetMark.visible = false;
    buttons([
      ["Skip step", "next", () => nextAfter(id)],
      ["Skip training", "skip", onExit],
    ]);
  };

  const onEvent = (e: TrainingEvent) => {
    if (e.type === "progress") {
      if (e.lesson !== current) return;
      el("coach-progress").textContent = e.text;
      if (e.done && !done.has(e.lesson)) {
        done.add(e.lesson);
        coach.dataset.done = "true";
        canvas.dataset.trainDone = [...done].join(",");
        const id = e.lesson;
        nextTimer = window.setTimeout(() => nextAfter(id), NEXT_MS);
      }
    } else if (e.type === "shot") {
      // the words now; "landed in/out" and the mark once it lands
      feedback(shotFeedback(e.report), "hit");
      landMark.visible = false;
    } else if (e.type === "landed") {
      const l = e.report.landing!;
      feedback(shotFeedback(e.report), "hit");
      landMat.color.set(l.in ? 0xffd23f : 0xff5a5a);
      landMark.position.set(l.x, 0.04, l.z);
      landMark.visible = !l.net;
      canvas.dataset.trainLanding = `${l.x.toFixed(2)},${l.z.toFixed(2)},${l.net ? "net" : l.in ? "in" : "out"}`;
    } else if (e.type === "miss") {
      feedback(missFeedback(e.miss, e.kind), "miss");
    } else if (e.type === "feed") {
      // for the e2e: where the fed ball will cross your baseline
      canvas.dataset.trainFeed = e.crossX === null ? "" : `${e.crossX.toFixed(2)},${sim.state.players[0].x.toFixed(2)}`;
    }
    // the lit target follows the step
    const t = sim.currentTarget();
    targetMark.visible = t !== null && current === "targets";
    if (t) targetMark.position.set(t.x, 0.035, t.z);
  };
  const offTraining = link.onTraining(onEvent);
  // for the e2e: where you stand, so keys can walk you to a wide ball
  const offState = link.on((m) => {
    if (m.t === "state") canvas.dataset.trainX = sim.state.players[0].x.toFixed(2);
  });

  // Start: camera (safety notice, hand choice, start, visibility check: the
  // view's own camera panel), or keys and mouse, or skip to the lobby.
  coach.dataset.lesson = "start";
  setText(
    "Training",
    "Learn to play",
    "Practise against a ball machine: swing, forehand and backhand, timing, strength and moving. Nothing is scored and nothing leaves this device.",
  );
  buttons([
    [
      "Use my camera",
      "camera",
      () => {
        begin("swing");
        cameraButton.click();
      },
      true,
    ],
    ["Keys and mouse", "keys", () => begin("swing")],
    ["Skip training", "skip", onExit],
  ]);

  link.start();

  return () => {
    clearTimeout(nextTimer);
    hudObserver.disconnect();
    offTraining();
    offState();
    link.stop();
    coach.remove();
    landMark.removeFromParent();
    targetMark.removeFromParent();
    stopView();
  };
}
