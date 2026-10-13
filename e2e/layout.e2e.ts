import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("menu fits the viewport and is keyboard reachable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /practice vs bot/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /create a room/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Join" })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);

  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
});

test("practice game renders inside the viewport", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /practice vs bot/i }).click();

  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  await expect.poll(async () => Number(await canvas.getAttribute("data-frames"))).toBeGreaterThan(5);

  const viewport = page.viewportSize()!;
  const box = (await canvas.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

  await expect(page.locator(".score")).toContainText("You");
  for (const name of [/move left/i, /light swing/i, /medium swing/i, /hard swing/i, /move right/i]) {
    const button = page.getByRole("button", { name });
    await expect(button).toBeVisible();
    const b = (await button.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(viewport.width);
    expect(b.y + b.height).toBeLessThanOrEqual(viewport.height);
    expect(b.height).toBeGreaterThanOrEqual(44);
  }
  expect(await noHorizontalScroll(page)).toBe(true);
});

/** Collects the JSON messages the page sends over its WebSocket. */
function sentMessages(page: Page): Record<string, unknown>[] {
  const sent: Record<string, unknown>[] = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => sent.push(JSON.parse(String(f.payload)))));
  return sent;
}

test("keyboard moves, aims and swings at each level", async ({ page }) => {
  const sent = sentMessages(page);
  await page.goto("/");
  await page.getByRole("button", { name: /practice vs bot/i }).click();
  await expect(page.locator("canvas")).toBeVisible();

  await page.keyboard.down("KeyD");
  await expect.poll(() => sent.some((m) => m.t === "move" && Number(m.x) > 0)).toBe(true);
  await page.keyboard.up("KeyD");
  await page.keyboard.down("ArrowLeft");
  await page.keyboard.press("Digit3");
  // plus why it would miss, when it would (e.g. during the serve: no ball to hit)
  await expect(page.locator(".stroke")).toHaveText(/^(Forehand|Backhand) · hard( · (no ball to hit|too early|too late|out of reach|too high))?$/);
  await page.keyboard.up("ArrowLeft");
  await page.keyboard.press("Digit1");
  await page.keyboard.press("Space");
  await expect.poll(() => sent.filter((m) => m.t === "swing").length).toBe(3);
  const swings = sent.filter((m) => m.t === "swing");
  expect(swings.map((m) => m.level)).toEqual([2, 0, 1]);
  expect(swings[0].dirX).toBe(-1);
  expect(swings.every((m) => m.kind === "forehand" || m.kind === "backhand")).toBe(true);

  await page.getByRole("button", { name: /leave/i }).click();
  await expect(page.getByRole("button", { name: /practice vs bot/i })).toBeVisible();
});

test("on-screen buttons move and swing", async ({ page }) => {
  const sent = sentMessages(page);
  await page.goto("/");
  await page.getByRole("button", { name: /practice vs bot/i }).click();
  await expect(page.locator("canvas")).toBeVisible();

  const right = page.getByRole("button", { name: /move right/i });
  const box = (await right.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect.poll(() => sent.some((m) => m.t === "move" && Number(m.x) > 0)).toBe(true);
  await page.mouse.up();
  await expect.poll(() => sent.filter((m) => m.t === "move").length).toBe(2);

  await page.getByRole("button", { name: /hard swing/i }).click();
  await expect.poll(() => sent.find((m) => m.t === "swing")?.level).toBe(2);
});

test("a swing carries the tick on screen, and the server allows rewind for it (ADR 001)", async ({ page }) => {
  const sent = sentMessages(page);
  const received: Record<string, unknown>[] = [];
  page.on("websocket", (ws) => ws.on("framereceived", (f) => received.push(JSON.parse(String(f.payload)))));
  await page.goto("/");
  await page.getByRole("button", { name: /practice vs bot/i }).click();
  await expect(page.locator("canvas")).toBeVisible();
  // the page answers pings, so the server has measured this player's lag
  await expect.poll(() => sent.some((m) => m.t === "pong")).toBe(true);
  await expect.poll(() => received.filter((m) => m.t === "state").length).toBeGreaterThan(10);

  // a few swings, spaced past the server's swing cooldown
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Space");
    await page.waitForTimeout(350);
  }
  await expect.poll(() => received.filter((m) => m.t === "swing").length).toBe(4);
  const swings = sent.filter((m) => m.t === "swing");
  const states = received.filter((m) => m.t === "state").map((m) => (m.state as { tick: number }).tick);
  for (const swing of swings) {
    expect(Number.isInteger(swing.tick)).toBe(true);
    // the screen never runs more than 9 ticks past what the server sent
    expect(swing.tick as number).toBeLessThanOrEqual(Math.max(...states) + 9);
  }
  const rulings = received.filter((m) => m.t === "swing");
  expect(rulings.every((r) => r.rtt !== null)).toBe(true);
  // the screen is always a little behind the server, so the server allows
  // rewind; before the client sent its tick this was 0 for every real swing
  expect(rulings.some((r) => (r.allowed as number) > 0)).toBe(true);
});
