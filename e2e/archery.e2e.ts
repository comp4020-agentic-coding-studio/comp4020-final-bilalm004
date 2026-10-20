import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// Task 22: archery at both viewports. Keys and the hold button stand in for
// the bow gesture, as every camera action has one.

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

/** The box of an element's text (a full-width status row is mostly empty). */
const textBox = (el: Locator) =>
  el.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    return r.width > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  });

/** None of these overlap each other, and each is on screen. A `.status` counts by its text. */
async function laidOut(page: Page, selectors: string[]): Promise<void> {
  const boxes: Array<[string, Box]> = [];
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (!(await el.isVisible())) continue;
    await insideViewport(page, el);
    const box = sel.endsWith(".status") ? await textBox(el) : await el.boundingBox();
    if (box) boxes.push([sel, box]);
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i][1], boxes[j][1]), `${boxes[i][0]} overlaps ${boxes[j][0]}`).toBe(false);
  expect(await noHorizontalScroll(page)).toBe(true);
}

const canvas = (page: Page) => page.locator(".archery canvas");

async function openArchery(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /Archery/ }).click();
  await expect(page.locator("#options-title")).toHaveText("Archery");
}

/** Hold the shoot button for `ms`, then let go. */
async function holdShoot(page: Page, ms: number): Promise<void> {
  const b = page.locator(".ar-shoot");
  await expect(b).toBeEnabled();
  const box = (await b.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

test("the archery tile is playable and opens its own options", async ({ page }) => {
  await openArchery(page);
  const tile = page.getByRole("button", { name: /Archery/ });
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  await expect(tile.locator(".sport-soon")).toHaveCount(0);
  for (const name of ["Play vs bot", "Practice", "Create a room"]) await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
});

test("practice: aim, draw and shoot in the page, nothing sent to the server", async ({ page }) => {
  const frames: string[] = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => frames.push(String(f.payload))));
  await openArchery(page);
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-frames"))).toBeGreaterThan(5);
  const sent = frames.length;

  await laidOut(page, [".hud .ar-score", ".hud button:visible", ".ar-wind", ".ar-card", ".ar-practice", ".ar-draw", ".controls"]);
  await expect(page.locator(".ar-score")).toContainText("Practice · 10 m");
  await expect(page.locator(".ar-row")).toHaveCount(1);

  // the no-wind preview sits on the face and moves with the arrow keys
  const before = await canvas(page).getAttribute("data-preview");
  expect(before).toMatch(/^-?\d/);
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(300);
  await page.keyboard.up("ArrowUp");
  await expect.poll(() => canvas(page).getAttribute("data-preview")).not.toBe(before);

  // hold to draw: the bar fills; let go: the arrow lands and is scored
  await holdShoot(page, 900);
  await expect(canvas(page)).toHaveAttribute("data-shots", "1", { timeout: 5_000 });
  await expect(page.locator(".ar-row b")).toHaveCount(1);

  // pick a far distance and a strong left wind: the level and dial follow
  await page.locator("[data-pick=level]").selectOption({ label: "50 m" });
  await page.locator("[data-pick=wind]").selectOption({ label: "Strong" });
  await page.locator("[data-pick=angle]").selectOption({ label: "← Left" });
  await expect(canvas(page)).toHaveAttribute("data-distance", "50");
  await expect(page.locator(".ar-wind")).toHaveAttribute("data-speed", "8.0");
  await expect(page.locator(".ar-wind")).toHaveAttribute("data-angle", "180");
  await expect(page.locator(".ar-wind")).toHaveAttribute("aria-label", /8\.0 metres per second, blowing left/);

  // only the page's own keep-alive replies (pong) may go over the socket it opened on load
  expect(frames.slice(sent).map((f) => JSON.parse(f).t).filter((t) => t !== "pong"), "practice sends nothing").toEqual([]);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("#options-title")).toHaveText("Archery");
});

test("press and hold on the range draws and letting go shoots, with no drag needed", async ({ page }) => {
  await openArchery(page);
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-frames"))).toBeGreaterThan(5);
  const box = (await canvas(page).boundingBox())!;
  // aim at the middle of the screen, then hold still: the draw grows while held
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-draw"))).toBeGreaterThan(0.3);
  await page.mouse.up();
  await expect(canvas(page)).toHaveAttribute("data-shots", "1", { timeout: 5_000 });
});

test("Space draws and shoots straight after opening practice", async ({ page }) => {
  await openArchery(page);
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-frames"))).toBeGreaterThan(5);
  await page.keyboard.down("Space");
  await page.waitForTimeout(900);
  await page.keyboard.up("Space");
  await expect(canvas(page)).toHaveAttribute("data-shots", "1", { timeout: 5_000 });
});

test("vs the bot: the server takes turns, flies both arrows and scores them", async ({ page }) => {
  test.setTimeout(60_000);
  await openArchery(page);
  await page.getByRole("button", { name: "Play vs bot" }).click();
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-frames"))).toBeGreaterThan(5);
  await laidOut(page, [".hud .ar-score", ".hud .status", ".ar-wind", ".ar-card", ".ar-draw", ".controls"]);
  await expect(page.locator(".ar-row")).toHaveCount(2);
  await expect(page.locator(".ar-score")).toContainText("Stage 1 of 8 · 10 m");
  await expect(page.locator(".status")).toHaveText(/Your shot/);

  await holdShoot(page, 900);
  // my arrow, then the bot's (it draws and shoots on its own turn)
  await expect(canvas(page)).toHaveAttribute("data-shots", "2", { timeout: 15_000 });
  await expect(page.locator('.ar-row[data-seat="1"] b')).toHaveCount(1);
  // stage two, with the bot shooting first
  await expect(page.locator(".ar-score")).toContainText("Stage 2 of 8 · 15 m", { timeout: 10_000 });
});

test("a room offers archery's own formats", async ({ page }) => {
  await openArchery(page);
  await page.getByRole("button", { name: "Create a room" }).click();
  const panel = page.locator(".ready-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator("[data-format]")).toHaveText(["Eight stages", "Unlimited"]);
  await expect(panel.locator('[data-format="stages"]')).toHaveAttribute("aria-checked", "true");
  await insideViewport(page, panel);
  expect(await noHorizontalScroll(page)).toBe(true);
});
