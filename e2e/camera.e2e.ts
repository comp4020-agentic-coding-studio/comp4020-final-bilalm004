import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// Runs with Chrome's fake webcam (playwright.config.ts): a test pattern, no
// person in it, so the camera starts and the model loads but nothing is tracked.

const ALLOWED_MESSAGES = new Set(["hello", "create", "join", "move", "swing", "pause", "leave"]);

async function practice(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /practice vs bot/i }).click();
  await expect(page.locator("canvas")).toBeVisible();
}

async function insideViewport(page: Page, locator: Locator): Promise<void> {
  const v = page.viewportSize()!;
  const b = (await locator.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(v.width);
  expect(b.y + b.height).toBeLessThanOrEqual(v.height);
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("camera path: starts the fake webcam, loads the model, calibrates by skipping, and sends no video", async ({ page }) => {
  test.setTimeout(60_000);
  const finished: { method: string; host: string }[] = [];
  page.on("requestfinished", (r) => finished.push({ method: r.method(), host: new URL(r.url()).host }));
  const sent: string[] = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => sent.push(String(f.payload))));

  await practice(page);
  await page.getByRole("button", { name: "Camera", exact: true }).click();
  const panel = page.getByRole("dialog", { name: /camera setup/i });
  await expect(panel.getByRole("heading", { name: /play with your camera/i })).toBeVisible();
  await insideViewport(page, panel);
  await expect(page.locator(".hud .status")).toHaveText(/paused/i);
  await panel.getByRole("button", { name: /left-handed/i }).click();
  await expect(panel.getByRole("button", { name: /left-handed/i })).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: /start camera/i }).click();

  const video = page.locator("video.selfview");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(panel.getByRole("heading", { name: /stand neutral/i })).toBeVisible({ timeout: 40_000 });
  await expect(page.locator(".tracking")).toHaveText(/can't see you|tracking/i);
  await insideViewport(page, panel);
  await insideViewport(page, video);
  expect(await noHorizontalScroll(page)).toBe(true);

  // nobody in the fake video, so capturing the neutral can't succeed
  await panel.getByRole("button", { name: "Capture" }).click();
  await expect(panel.getByRole("status")).toHaveText(/couldn't see/i, { timeout: 5000 });
  await panel.getByRole("button", { name: "Skip" }).click();
  await expect(panel.getByRole("heading", { name: /swing light/i })).toBeVisible();
  await panel.getByRole("button", { name: "Skip" }).click();
  await panel.getByRole("button", { name: "Skip" }).click();
  await panel.getByRole("button", { name: "Done" }).click();
  await expect(panel).toBeHidden();
  await expect(page.locator(".hud .status")).not.toHaveText(/paused/i);
  expect(sent.filter((m) => JSON.parse(m).t === "pause").map((m) => JSON.parse(m).paused)).toEqual([true, false]);

  // the keyboard still plays alongside the camera
  await page.keyboard.press("Digit3");
  await expect.poll(() => sent.some((m) => JSON.parse(m).t === "swing")).toBe(true);
  await page.getByRole("button", { name: /stop camera/i }).click();
  await expect(page.locator(".tracking")).toBeHidden();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.srcObject)).toBeNull();

  // Privacy: only downloads (page, model, runtime) and small game messages
  // leave the browser. MediaPipe's own usage pings are blocked by the page's
  // content security policy, so they never complete.
  const allowedHosts = new Set([new URL(page.url()).host, "cdn.jsdelivr.net", "storage.googleapis.com"]);
  expect(finished.filter((r) => r.method !== "GET" || !allowedHosts.has(r.host))).toEqual([]);
  for (const m of sent) {
    expect(m.length).toBeLessThan(200);
    expect(ALLOWED_MESSAGES.has(JSON.parse(m).t)).toBe(true);
  }
});

for (const [name, script, message] of [
  [
    "denied",
    () => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
    },
    /camera blocked/i,
  ],
  [
    "missing",
    () => {
      Object.defineProperty(navigator, "mediaDevices", { value: undefined });
    },
    /can't use a camera/i,
  ],
] as const) {
  test(`camera ${name}: explains why and the game stays playable`, async ({ page }) => {
    await page.addInitScript(script);
    const sent: string[] = [];
    page.on("websocket", (ws) => ws.on("framesent", (f) => sent.push(String(f.payload))));
    await practice(page);

    await page.getByRole("button", { name: "Camera", exact: true }).click();
    const panel = page.getByRole("dialog", { name: /camera setup/i });
    await panel.getByRole("button", { name: /start camera/i }).click();
    await expect(panel.getByRole("alert")).toHaveText(message);
    await insideViewport(page, panel);
    await panel.getByRole("button", { name: /keep playing/i }).click();
    await expect(panel).toBeHidden();
    await expect(page.locator(".tracking")).toHaveText(/camera off/i);

    const hard = page.getByRole("button", { name: /hard swing/i });
    await insideViewport(page, hard);
    await hard.click();
    await expect.poll(() => sent.some((m) => JSON.parse(m).t === "swing" && JSON.parse(m).level === 2)).toBe(true);
    expect(await noHorizontalScroll(page)).toBe(true);
  });
}

test("the reticle is always on the opponent's half and follows the aim", async ({ page }) => {
  test.setTimeout(45_000);
  await practice(page);
  const canvas = page.locator("canvas");
  const reticle = async () => {
    const [x, z, , source] = ((await canvas.getAttribute("data-reticle")) ?? "").split(",");
    return { x: Number(x), z: Number(z), source };
  };
  // showing straight away, during the serve, from aim alone
  await expect.poll(async () => (await reticle()).source).toBe("aim");
  // seat 0 views from +z: the opponent's half is z < 0, and aiming right is +x
  await page.keyboard.down("ArrowRight");
  await expect.poll(async () => (await reticle()).x).toBeGreaterThan(1);
  await page.keyboard.up("ArrowRight");
  await page.keyboard.down("ArrowLeft");
  await expect.poll(async () => (await reticle()).x).toBeLessThan(-1);
  await page.keyboard.up("ArrowLeft");

  // through serves and returns, it never comes onto your side
  for (let i = 0; i < 40; i++) {
    const r = await reticle();
    expect(r.z).toBeLessThan(0);
    await page.waitForTimeout(150);
  }
});
