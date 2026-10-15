import { Mesh, MeshBasicMaterial, RingGeometry } from "three";
import type { Scene } from "three";
import "./training.css";
import { LESSONS, MOVEMENT_OFFER, REQUIRED_LESSONS, TARGET_RADIUS, afterLesson, missFeedback, shotFeedback, trainingComplete, wrongShotNote } from "./lessons.ts";
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
  // The machine waits (startPaused) until Start, so no ball flies while the
  // player sets up their camera, and training always starts in auto-move,
  // whatever lean was saved from an earlier session (user's playtest).
  const sim = new TrainingSim((Math.random() * 2 ** 32) >>> 0, "right", { startPaused: true });
  sim.reset();
  const link = new LocalLink(sim);
  let scene: Scene | null = null;
  // the camera input, so the movement drill can switch it to lean and back
  let camera: { setMoveMode(mode: "auto" | "tilt"): void } | null = null;
  // held: a step (or the setup) is showing centred and the machine waits for Ready
  let held = true;
  const stopView = startTennis(root, link, { room: "TRAIN", game: "tennis", seat: 0, practice: true }, onExit, {
    local: true,
    leaveLabel: "Skip training",
    onScene: (s) => (scene = s),
    startMoveMode: "auto",
    onCamera: (c) => (camera = c),
    holdPause: () => held,
  });
  const view = root.querySelector(".game") as HTMLElement;
  view.classList.add("training");
  // setup: the coach is centred over the paused court; Start moves it to the side
  view.classList.add("setup");
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
    <p class="coach-why" hidden></p>
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
  // The coach slides from the centre to its side when Start is pressed. Its
  // size doesn't change while it moves, so the observer never fires and the
  // camera dock would be placed from a measurement taken mid-slide: measure
  // again when the slide ends.
  coach.addEventListener("transitionend", placeBelowHud);
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
    // nothing about shots while a step is held: there is no ball to talk about
    if (held) return;
    const f = el("coach-feedback");
    f.textContent = text;
    f.dataset.kind = kind;
  };

  // the "why" is shown as a short plain line with the step, never a drop-down
  const why = el("coach-why");
  const setWhy = (text: string | undefined) => {
    why.hidden = !text;
    why.textContent = text ?? "";
  };

  // between steps (the movement offer, the end screen): no lesson running; centred, machine held
  const idle = (lesson: string) => {
    if (current === "movement") camera?.setMoveMode("auto");
    current = null;
    coach.dataset.lesson = lesson;
    coach.dataset.done = "false";
    coach.dataset.stage = "present";
    sim.setLesson("targets");
    targetMark.visible = false;
    setWhy(undefined);
    held = true;
    view.classList.add("setup");
    link.send({ t: "pause", paused: true });
  };

  const finish = () => {
    idle("done");
    setText(
      trainingComplete(done) ? "Training complete" : "Training over",
      "You're ready to play",
      "Practise against the bot, or play a friend from the lobby.",
    );
    const extras: [string, string, () => void][] = [];
    if (!done.has("movement")) extras.push(["Practise moving", "movement", () => begin("movement")]);
    if (!done.has("targets")) extras.push(["Try targets", "targets", () => begin("targets")]);
    buttons([["Go to the lobby", "lobby", onExit, true], ...extras]);
  };

  // user's call: auto-move is on throughout; moving yourself is offered, not required
  const offerMovement = () => {
    idle("offer");
    setText("Optional", MOVEMENT_OFFER.question, "Training is done either way.");
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

  // Each step opens centred with the machine held, a few words and one Ready
  // button (user's ruling: first in front, then to the side once ready).
  const hold = () => {
    held = true;
    // the last step's shot and progress mean nothing to a new, still step
    el("coach-feedback").textContent = "";
    el("coach-feedback").dataset.kind = "";
    view.classList.add("setup");
    link.send({ t: "pause", paused: true });
  };
  const release = () => {
    held = false;
    view.classList.remove("setup");
    link.send({ t: "pause", paused: false });
    // measure again once it has slid to its place
    setTimeout(placeBelowHud, 450);
  };

  const begin = (id: LessonId) => {
    clearTimeout(nextTimer);
    // leaving the movement drill (skip or done): auto again for everything else
    if (current === "movement" && id !== "movement") camera?.setMoveMode("auto");
    current = id;
    const lesson = LESSONS.find((l) => l.id === id)!;
    const n = REQUIRED_LESSONS.findIndex((l) => l.id === id);
    setText(n >= 0 ? `Step ${n + 1} of ${REQUIRED_LESSONS.length}` : "Extra", lesson.title, lesson.how);
    setWhy(lesson.why);
    coach.dataset.lesson = id;
    coach.dataset.done = "false";
    coach.dataset.stage = "present";
    // set the step up now (its drill, an empty record) but hold the machine until Ready
    const events = sim.setLesson(id);
    canvas.dataset.trainFeed = "";
    link.emitTraining(events);
    targetMark.visible = false;
    hold();
    buttons([
      ["Ready", "ready", () => go(id), true],
      ["Skip step", "next", () => nextAfter(id)],
      ["Skip training", "skip", onExit],
    ]);
  };

  // Ready: the card slides to the side and the machine starts feeding this step
  const go = (id: LessonId) => {
    coach.dataset.stage = "play";
    // the movement drill is the one place you move yourself: lean works then
    camera?.setMoveMode(id === "movement" ? "tilt" : "auto");
    release();
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
      // the words for the shot, then (if it wasn't the one asked for) why it didn't count
      const note = current === "timing" || current === "strength" ? wrongShotNote(current, e.report, sim.wantedBeforeLast()) : null;
      feedback(note ? `${shotFeedback(e.report)}. ${note}` : shotFeedback(e.report), note ? "miss" : "hit");
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

  // Setup (centred, game held): short. Camera first (its own panel: safety
  // notice, hand choice, start, visibility check), or keys and mouse. Start
  // releases the machine and moves the coach to the side.
  // Start is held until the camera is set up, or the player chooses keys only
  // (the camera is never required: every camera action has a key equivalent)
  let setupDone = false;
  const ready = () => {
    if (!setupDone) return;
    // on to step 1, which opens centred with the machine still held
    begin("swing");
  };
  coach.dataset.lesson = "start";
  setText("Training", "Learn to play", "Set up your camera, or choose keys only. Then press Start.");
  const showSetup = () => {
    buttons([
      ["Set up camera", "camera", () => cameraButton.click(), !setupDone],
      ["Keys only", "keys", () => {
        setupDone = true;
        showSetup();
      }],
      ["Start", "start", ready, setupDone],
      ["Skip training", "skip", onExit],
    ]);
    // not yet: pressing Start does nothing until the camera is set up or keys are chosen
    const start = row.querySelector('[data-coach="start"]') as HTMLButtonElement;
    start.disabled = !setupDone;
  };
  showSetup();
  // the camera finishing its setup (running, panel closed) is what unlocks Start
  const watchCamera = window.setInterval(() => {
    // the camera is running (its preview is showing) and its setup panel has closed
    const video = view.querySelector(".cam-dock video") as HTMLVideoElement | null;
    if (held && !setupDone && video && !video.hidden && !view.classList.contains("calibrating")) {
      setupDone = true;
      showSetup();
    }
  }, 200);

  link.start();

  return () => {
    clearTimeout(nextTimer);
    clearInterval(watchCamera);
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
