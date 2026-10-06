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
  await expect(page.locator(".stroke")).toHaveText(/^(Forehand|Backhand) · hard$/);
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
