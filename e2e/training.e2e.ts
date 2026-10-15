import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// Task 5: training mode. Runs at both viewports with Chrome's fake webcam
// (nobody in it, so the camera starts but tracks nothing; keys stand in for
// the swings, as every camera action has a key equivalent).

type Box = { x: number; y: number; width: number; height: number };
const overlap = (p: Box, q: Box) => p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function insideViewport(page: Page, locator: Locator): Promise<void> {
  const v = page.viewportSize()!;
  const b = (await locator.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(v.width);
  expect(b.y + b.height).toBeLessThanOrEqual(v.height);
}

/** The coach panel is on screen and covers none of the game's own HUD. */
async function coachClear(page: Page): Promise<void> {
  const coach = page.locator(".coach");
  await expect(coach).toBeVisible();
  await insideViewport(page, coach);
  const c = (await coach.boundingBox())!;
  for (const sel of [".hud button:visible", ".hud .score", ".aid", ".aid-meter", ".cam-dock", ".shot-label", ".stroke", ".controls"]) {
    for (const el of await page.locator(sel).all()) {
      const b = await el.boundingBox();
      if (b && b.width > 0 && b.height > 0) expect(overlap(c, b), `coach covers ${sel}`).toBe(false);
    }
  }
  expect(await noHorizontalScroll(page)).toBe(true);
}

/** Every frame the page sends over a WebSocket and every request it makes, from now on. */
function traffic(page: Page) {
  const frames: string[] = [];
  const requests: string[] = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => frames.push(String(f.payload))));
  page.on("request", (r) => requests.push(`${r.method()} ${r.url()}`));
  return { frames, requests };
}

/**
 * Each step opens centred with the machine held (stage "present"); Ready
 * slides it to the side and starts the ball machine for that step.
 */
async function ready(page: Page): Promise<void> {
  const coach = page.locator(".coach");
  await expect(coach).toHaveAttribute("data-stage", "present");
  // centred while held: it slides back to the middle (0.35 s), so poll until it is there
  const v = page.viewportSize()!;
  await expect
    .poll(async () => { const b = (await coach.boundingBox())!; return Math.abs(b.x + b.width / 2 - v.width / 2); }, { timeout: 3_000, message: "centred sideways" })
    .toBeLessThan(8);
  await coach.getByRole("button", { name: "Ready" }).click();
  await expect(coach).toHaveAttribute("data-stage", "play");
  // let it slide to its side before anything measures it
  await page.waitForTimeout(500);
}

/** Waits for the ball to be in `third` of the hit window, then presses `key`: a swing aimed by timing. */
async function swingIn(page: Page, third: "early" | "ontime" | "late", key = "Space"): Promise<void> {
  const meter = page.locator(".aid-meter");
  // the meter is lit for one third of each ball's flight; on a loaded machine
  // the third you want can take several balls to come round
  await expect.poll(() => meter.getAttribute("data-lit"), { timeout: 45_000, intervals: [10] }).toBe(third);
  await page.keyboard.press(key);
}

/** What the card asks for right now ("Now: swing early, and land it in"), read as a player would. */
async function asked(page: Page): Promise<{ third?: "early" | "ontime" | "late"; key?: string }> {
  const text = (await page.locator(".coach-progress").innerText()).toLowerCase();
  if (text.includes("swing early")) return { third: "early" };
  if (text.includes("swing on time")) return { third: "ontime" };
  if (text.includes("swing late")) return { third: "late" };
  if (text.includes("light swing")) return { key: "Digit1" };
  if (text.includes("medium swing")) return { key: "Digit2" };
  if (text.includes("hard swing")) return { key: "Digit3" };
  return {};
}

/** Swings until the coach marks the current step done (a missed ball just feeds another). */
async function untilDone(page: Page, swing: (k: number) => Promise<void>, tries = 10): Promise<void> {
  const coach = page.locator(".coach");
  const lesson = await coach.getAttribute("data-lesson");
  // done, or already moved on to the next step (it does so by itself)
  const over = async () => (await coach.getAttribute("data-done")) === "true" || (await coach.getAttribute("data-lesson")) !== lesson;
  const canvas = page.locator("canvas");
  for (let k = 0; k < tries; k++) {
    if (await over()) break;
    const landing = await canvas.getAttribute("data-train-landing");
    await swing(k);
    // A hit only counts once it lands, about 1.4 s after the swing for a deep
    // ball; until then the card still asks for the same shot. Wait for the
    // landing (or, after a miss, the next ball, or the step ending) before
    // reading the card again. A fixed wait read it too early, asked for the
    // same third again just as the step finished, and then the next step held
    // the machine, so no ball came (found by the investigation agent: not a game bug).
    await canvas.evaluate((c) => (c.dataset.trainFeed = ""));
    await expect
      .poll(async () => (await over()) || (await canvas.getAttribute("data-train-landing")) !== landing || ((await canvas.getAttribute("data-train-feed")) ?? "") !== "", { timeout: 10_000 })
      .toBe(true);
  }
  expect(await over(), `${lesson} completes`).toBe(true);
  // then wait for the coach to move on, so the next step starts clean
  await expect(coach).not.toHaveAttribute("data-lesson", lesson!, { timeout: 5_000 });
}

test("training with keys: every step completes from real key presses, feedback in words, nothing sent to the server", async ({ page }) => {
  test.setTimeout(240_000);
  const net = traffic(page);
  await page.goto("/");
  await expect(page.getByText(/playing as/i)).toBeVisible();
  const train = page.getByRole("button", { name: "Train" });
  await insideViewport(page, train);
  // what the page itself sent while loading (hello and the like); training adds nothing
  const framesBefore = net.frames.length;
  const requestsBefore = net.requests.length;
  await train.click();

  const coach = page.locator(".coach");
  const canvas = page.locator("canvas");
  await expect(coach.getByRole("heading", { name: /learn to play/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip training" }).first()).toBeVisible();
  // no room: no score, no room code, no invite
  await expect(page.locator(".hud .score")).toBeHidden();
  await expect(page.getByRole("button", { name: /copy invite/i })).toBeHidden();
  await expect.poll(async () => Number(await canvas.getAttribute("data-frames"))).toBeGreaterThan(5);
  await coachClear(page);

  await coach.getByRole("button", { name: /keys only/i }).click();
  await coach.getByRole("button", { name: "Start" }).click();

  // 1: any swing
  await expect(coach).toHaveAttribute("data-lesson", "swing");
  await ready(page);
  await page.keyboard.press("Space");
  await expect(coach).toHaveAttribute("data-done", "true");
  await expect(coach).toHaveAttribute("data-lesson", "forehand", { timeout: 5_000 });

  // 2, 3: forehand and backhand, fed to that side; keys pick the stroke that suits the ball
  for (const lesson of ["forehand", "backhand"]) {
    await expect(coach).toHaveAttribute("data-lesson", lesson);
    await ready(page);
    await swingIn(page, "ontime");
    // the feedback is in words, then where it landed. Which third the key
    // lands in can slip under a starved frame rate; the words for each third
    // are table-tested in spec/training.test.ts.
    await expect(coach.locator(".coach-feedback")).toHaveText(
      /^(Early, cross-court to the (left|right)|On time, straight|Late, down the line to the (left|right)), medium, (landed (in|out)|into the net)$/,
    );
    await expect(coach.locator(".coach-feedback")).toHaveAttribute("data-kind", "hit");
    await coachClear(page);
    await untilDone(page, () => swingIn(page, "ontime"));
  }

  // 4: when you swing sets where it lands: one early, one on time, one late, each landing in
  await expect(coach).toHaveAttribute("data-lesson", "timing");
  // a short "why", shown plainly with the step (no drop-down)
  const why = coach.locator(".coach-why");
  await expect(why).toBeVisible();
  await expect(coach.locator("details, summary")).toHaveCount(0);
  await expect(why).toContainText(/run/i);
  await ready(page);
  await coachClear(page);
  // it asks for early, then on time, then late: swing what it asks for
  await untilDone(
    page,
    async () => {
      const want = await asked(page);
      await swingIn(page, want.third ?? "ontime");
    },
    20,
  );
  // the last landing, in words and marked on the court
  await expect.poll(() => canvas.getAttribute("data-train-landing")).toMatch(/^-?\d+\.\d+,-\d+\.\d+,(in|out|net)$/);

  // 5: strength: a light (1), a medium (2) and a hard (3), in that order, each landing in
  await expect(coach).toHaveAttribute("data-lesson", "strength");
  await expect(why).toBeVisible();
  await ready(page);
  // light, then medium, then hard: swing what it asks for
  await untilDone(
    page,
    async () => {
      const want = await asked(page);
      await swingIn(page, "ontime", want.key ?? "Digit2");
    },
    20,
  );

  // required steps done: auto-move is on, moving yourself is offered, not required
  await expect(coach.getByRole("heading", { name: "Practise moving yourself?" })).toBeVisible();
  await expect(coach.getByRole("button", { name: "No thanks" })).toBeVisible();
  await coach.getByRole("button", { name: "Yes", exact: true }).click();

  // optional movement: auto-move off; each ball goes to the side away from where you stand, so it takes a run
  await expect(coach).toHaveAttribute("data-lesson", "movement");
  await ready(page);
  await untilDone(
    page,
    async () => {
      await expect.poll(() => canvas.getAttribute("data-train-feed"), { timeout: 20_000 }).not.toBe("");
      const [cross, me] = (await canvas.getAttribute("data-train-feed"))!.split(",").map(Number);
      await canvas.evaluate((c) => (c.dataset.trainFeed = ""));
      // the drill never moves you; it feeds to the side away from where you stand, so it takes a run
      expect(Math.sign(cross) * Math.sign(me) <= 0 || Math.abs(me) < 0.5, "the ball goes away from where you stand").toBe(true);
      expect(Math.abs(cross - me), "and takes a run").toBeGreaterThan(1.4);
      // seat 0 is viewed from behind, so screen right (D) is world +x
      const dir = cross > me ? 1 : -1;
      // hold until about 0.6 m short of where it crosses, so it is in reach and on one side
      const stop = cross - dir * 0.6;
      await page.keyboard.down(dir > 0 ? "KeyD" : "KeyA");
      await expect
        .poll(async () => (Number(await canvas.getAttribute("data-train-x")) - stop) * dir, { timeout: 5_000, intervals: [10] })
        .toBeGreaterThanOrEqual(-0.15);
      await page.keyboard.up(dir > 0 ? "KeyD" : "KeyA");
      await swingIn(page, "ontime");
    },
    10,
  );

  // done: off to the lobby, or the optional targets
  await expect(coach.getByRole("heading", { name: /ready to play/i })).toBeVisible();
  await expect(coach.locator(".coach-step")).toHaveText("Training complete");
  await expect(coach.getByRole("button", { name: /try targets/i })).toBeVisible();
  await coachClear(page);
  await coach.getByRole("button", { name: /go to the lobby/i }).click();
  await expect(page.getByRole("button", { name: /practice vs bot/i })).toBeVisible();

  // Nothing from training reached the server: no room, no swings, no moves.
  // Only the page's own keep-alive replies (pong) may go over the socket it opened on load.
  const during = net.frames.slice(framesBefore).map((f) => JSON.parse(f).t);
  expect(during.filter((t) => t !== "pong")).toEqual([]);
  expect(net.requests.slice(requestsBefore)).toEqual([]);
});

test("training with the camera: safety notice and hand choice first, the camera check, then the steps; skippable", async ({ page }) => {
  test.setTimeout(120_000);
  const net = traffic(page);
  await page.goto("/");
  await expect(page.getByText(/playing as/i)).toBeVisible();
  const framesBefore = net.frames.length;
  await page.getByRole("button", { name: "Train" }).click();
  const coach = page.locator(".coach");
  await coach.getByRole("button", { name: /set up camera/i }).click();

  const panel = page.getByRole("dialog", { name: /camera setup/i });
  await expect(panel.getByRole("heading", { name: /before you start/i })).toBeVisible();
  await insideViewport(page, panel);
  // the coach steps aside while the camera panel is open
  await expect(coach).toBeHidden();
  await panel.getByRole("button", { name: "Got it" }).click();
  await expect(panel.getByRole("group", { name: /racket hand/i })).toBeVisible();
  await panel.getByRole("button", { name: /left-handed/i }).click();
  await expect(panel.getByRole("button", { name: /aim by timing/i })).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: /start camera/i }).click();
  await expect(panel.getByRole("heading", { name: /can we see you/i })).toBeVisible({ timeout: 40_000 });
  await panel.getByRole("button", { name: "Skip check" }).click();
  await expect(panel).toBeHidden();

  // the camera is set up, but training is still held: the coach is back, centred,
  // and nothing starts until Start
  await expect(coach).toBeVisible();
  await expect(coach).toHaveAttribute("data-lesson", "start");
  await coach.getByRole("button", { name: "Start" }).click();

  // first step: a swing, the camera check. It opens centred with the machine held, then Ready sends it to the side
  await expect(coach).toHaveAttribute("data-lesson", "swing");
  await ready(page);
  await expect(page.locator(".cam-dock video")).toBeVisible();
  await expect(page.getByRole("img", { name: /timing meter/i })).toBeVisible();
  await coachClear(page);
  // a key swing stands in for the camera swing (nobody is in the fake video);
  // 2, not Space: closing the panel focuses the Camera button, and Space would press it
  await page.keyboard.press("Digit2");
  await expect(coach).toHaveAttribute("data-done", "true");
  await expect(coach).toHaveAttribute("data-lesson", "forehand", { timeout: 5_000 });
  await coachClear(page);

  // a returning player can leave at any step
  await coach.getByRole("button", { name: "Skip training" }).click();
  await expect(page.getByRole("button", { name: /practice vs bot/i })).toBeVisible();
  await expect.poll(() => page.locator("video").count()).toBe(0);

  // the camera never sent anything: no frames to the server from training at all
  const during = net.frames.slice(framesBefore).map((f) => JSON.parse(f).t);
  expect(during.filter((t) => t !== "pong")).toEqual([]);
});

test("Train is a Tennis option on the home screen, and Skip training goes straight back", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/playing as/i)).toBeVisible();
  const options = page.locator(".options");
  await expect(options.getByRole("button", { name: "Train" })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  await options.getByRole("button", { name: "Train" }).click();
  await expect(page).toHaveURL(/#\/train$/);
  const coach = page.locator(".coach");
  // no room, so no ready panel
  await expect(page.locator(".ready-panel")).toBeHidden();
  // "No thanks" to moving yourself ends training without the movement drill
  await coach.getByRole("button", { name: /keys only/i }).click();
  await coach.getByRole("button", { name: "Start" }).click();
  for (let i = 0; i < 5; i++) await coach.getByRole("button", { name: "Skip step" }).click();
  await coach.getByRole("button", { name: "No thanks" }).click();
  await expect(coach.getByRole("heading", { name: /ready to play/i })).toBeVisible();
  await expect(coach.getByRole("button", { name: "Practise moving" })).toBeVisible();
  await coachClear(page);
  await coach.getByRole("button", { name: /go to the lobby/i }).click();
  await expect(page.getByRole("button", { name: /practice vs bot/i })).toBeVisible();
  await page.getByRole("button", { name: "Train" }).click();
  await page.locator(".coach").getByRole("button", { name: "Skip training" }).click();
  await expect(page.getByRole("button", { name: /practice vs bot/i })).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("training waits: centred and paused, no ball and auto-move until Start, then the coach moves aside", async ({ page }) => {
  // a lean saved from an earlier session must not carry in
  await page.addInitScript(() => localStorage.setItem("move-mode", "tilt"));
  const sent: string[] = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => sent.push(String(f.payload))));
  await page.goto("/#/train");
  const coach = page.locator(".coach");
  const canvas = page.locator("canvas");
  await expect(coach).toBeVisible();
  await expect(coach).toHaveAttribute("data-lesson", "start");

  // centred: the card's middle is the screen's middle
  const v = page.viewportSize()!;
  const b = (await coach.boundingBox())!;
  expect(Math.abs(b.x + b.width / 2 - v.width / 2)).toBeLessThan(8);
  expect(Math.abs(b.y + b.height / 2 - v.height / 2)).toBeLessThan(v.height * 0.12);
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(v.width);

  await coach.getByRole("button", { name: /keys only/i }).click();
  // held: no ball is fed or in flight while the player sets up
  await page.waitForTimeout(3000);
  expect(Number((await canvas.getAttribute("data-trail")) ?? 0)).toBe(0);
  expect((await canvas.getAttribute("data-train-feed")) ?? "").toBe("");
  // and it is concise
  expect(((await coach.innerText()).match(/\S+/g) ?? []).length).toBeLessThan(30);

  // Start opens step 1 centred, still held: no ball yet
  await coach.getByRole("button", { name: "Start" }).click();
  await expect(coach).toHaveAttribute("data-lesson", "swing");
  await expect(coach).toHaveAttribute("data-stage", "present");
  await page.waitForTimeout(2500);
  expect(Number((await canvas.getAttribute("data-trail")) ?? 0)).toBe(0);
  // Ready releases the machine and moves the coach to the side
  await ready(page);
  await expect.poll(async () => Number((await canvas.getAttribute("data-trail")) ?? 0), { timeout: 20_000 }).toBeGreaterThan(0);
  // it has left the centre: to the left side on a wide screen, across the top on a phone
  await expect.poll(async () => (await coach.boundingBox())!.y + (await coach.boundingBox())!.height / 2, { timeout: 5_000 }).toBeLessThan(v.height * 0.4);
  const after = (await coach.boundingBox())!;
  if (v.width >= 900) expect(after.x + after.width / 2).toBeLessThan(v.width / 2);
  // the saved lean did not carry in: the mode sent to the sim is auto
  expect(sent.filter((m) => m.includes('"mode"') && m.includes("tilt"))).toEqual([]);
});

test("Set up camera opens a panel you can actually use (nothing dims or covers it), and Start waits for the camera", async ({ page }) => {
  await page.goto("/#/train");
  const coach = page.locator(".coach");
  await expect(coach).toHaveAttribute("data-lesson", "start");
  // before the camera is set up (or Keys only is chosen), Start can't be pressed
  await expect(coach.getByRole("button", { name: "Start" })).toBeDisabled();

  await coach.getByRole("button", { name: /set up camera/i }).click();
  const panel = page.getByRole("dialog", { name: /camera setup/i });
  await expect(panel.getByRole("heading", { name: /before you start/i })).toBeVisible();
  // the panel is the thing on top at its own centre, so a real click lands on it
  const top = await page.evaluate(() => {
    const el = document.querySelector(".camera-panel") as HTMLElement;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!hit && el.contains(hit);
  });
  expect(top, "something covers the camera panel").toBe(true);
  // and its buttons are plainly clickable (no force): a covering dim layer would refuse these
  await panel.getByRole("button", { name: "Got it" }).click();
  await expect(panel.getByRole("button", { name: /start camera/i })).toBeVisible();
  await panel.getByRole("button", { name: /start camera/i }).click();
  await expect(panel.getByRole("heading", { name: /can we see you/i })).toBeVisible({ timeout: 40_000 });
  await panel.getByRole("button", { name: "Skip check" }).click();
  await expect(panel).toBeHidden();

  // the camera is set up: now Start can be pressed
  await expect(coach.getByRole("button", { name: "Start" })).toBeEnabled();
});

test("Keys only is the no-camera way through: it does what the camera step does, and never requires a camera", async ({ page }) => {
  await page.goto("/#/train");
  const coach = page.locator(".coach");
  await expect(coach.getByRole("button", { name: "Start" })).toBeDisabled();
  await coach.getByRole("button", { name: /keys only/i }).click();
  await expect(coach.getByRole("button", { name: "Start" })).toBeEnabled();
  await coach.getByRole("button", { name: "Start" }).click();
  await expect(coach).toHaveAttribute("data-lesson", "swing");
});

test("every step opens centred with the machine held, and goes to the side only on Ready; each is short", async ({ page }) => {
  await page.goto("/#/train");
  const coach = page.locator(".coach");
  const canvas = page.locator("canvas");
  await coach.getByRole("button", { name: /keys only/i }).click();
  await coach.getByRole("button", { name: "Start" }).click();
  const v = page.viewportSize()!;
  const centredAndHeld = async (lesson: string) => {
    await expect(coach).toHaveAttribute("data-lesson", lesson);
    await expect(coach).toHaveAttribute("data-stage", "present");
    // it slides to the middle, so poll until it is there (sideways and up and down)
    const offCentre = async () => {
      const b = (await coach.boundingBox())!;
      return Math.max(Math.abs(b.x + b.width / 2 - v.width / 2), Math.abs(b.y + b.height / 2 - v.height / 2) - v.height * 0.1);
    };
    await expect.poll(offCentre, { timeout: 3_000, message: `${lesson}: centred` }).toBeLessThan(8);
    // quick to read: the title and the one instruction line, not a paragraph
    const words = ((await coach.locator(".coach-title, .coach-how").allInnerTexts()).join(" ").match(/\S+/g) ?? []).length;
    expect(words, `${lesson}: words to read`).toBeLessThanOrEqual(20);
    // held: the machine feeds nothing while it is being read (the old shot's
    // trail can still fade out, so the feed itself is what is checked)
    await canvas.evaluate((c) => (c.dataset.trainFeed = ""));
    await page.waitForTimeout(2500);
    expect((await canvas.getAttribute("data-train-feed")) ?? "", `${lesson}: no ball fed while held`).toBe("");
  };
  // the first step, then skip along: forehand and backhand open the same way
  for (const lesson of ["swing", "forehand", "backhand"]) {
    await centredAndHeld(lesson);
    // Ready: off to the side, and the ball machine starts
    await coach.getByRole("button", { name: "Ready" }).click();
    await expect(coach).toHaveAttribute("data-stage", "play");
    await page.waitForTimeout(500);
    const side = (await coach.boundingBox())!;
    if (v.width >= 900) expect(side.x + side.width / 2, `${lesson}: moved to the left side`).toBeLessThan(v.width / 2);
    else expect(side.y + side.height / 2, `${lesson}: moved up under the HUD`).toBeLessThan(v.height * 0.4);
    await coach.getByRole("button", { name: "Skip step" }).click();
  }
});

test("the timing step enforces what it asks for: an on-time hit when early is asked does not count, and says why", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/#/train");
  const coach = page.locator(".coach");
  await coach.getByRole("button", { name: /keys only/i }).click();
  await coach.getByRole("button", { name: "Start" }).click();
  // skip to the timing step
  for (const lesson of ["swing", "forehand", "backhand"]) {
    await expect(coach).toHaveAttribute("data-lesson", lesson);
    await coach.getByRole("button", { name: "Skip step" }).click();
  }
  await expect(coach).toHaveAttribute("data-lesson", "timing");
  // while held, nothing about earlier shots or a tally of "not yet"
  await expect(coach.locator(".coach-feedback")).toHaveText("");
  await expect(coach).not.toContainText(/not yet|Early in:/);
  await ready(page);
  await expect(coach.locator(".coach-progress")).toContainText(/swing early/i);

  // swing ON TIME although early is asked for
  await swingIn(page, "ontime");
  await expect(coach.locator(".coach-feedback")).toContainText(/That was on time\. We want early\./, { timeout: 15_000 });
  // it did not move the step on: early is still what is asked
  await expect(coach.locator(".coach-progress")).toContainText(/swing early/i);
  await expect(coach).toHaveAttribute("data-done", "false");
});

