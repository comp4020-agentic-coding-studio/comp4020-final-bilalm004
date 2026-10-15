import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// Trajectory aid (task 3): the timing meter along the bottom, the three
// timing arcs with the lit one following the ball, the strength readout and
// the off switch. Runs with Chrome's fake webcam: nobody is in it, so the
// camera runs (aiming by timing, the default) but no grip is tracked.

async function practice(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /practice vs bot/i }).click();
  await expect(page.locator("canvas")).toBeVisible();
}

async function startCamera(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Camera", exact: true }).click();
  const panel = page.getByRole("dialog", { name: /camera setup/i });
  await panel.getByRole("button", { name: "Got it" }).click();
  await expect(panel.getByRole("button", { name: /aim by timing/i })).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: /start camera/i }).click();
  await expect(panel.getByRole("heading", { name: /can we see you/i })).toBeVisible({ timeout: 40_000 });
  await panel.getByRole("button", { name: "Skip check" }).click();
  await expect(panel).toBeHidden();
}

async function insideViewport(page: Page, locator: Locator): Promise<void> {
  const v = page.viewportSize()!;
  const b = (await locator.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(v.width);
  expect(b.y + b.height).toBeLessThanOrEqual(v.height);
}

async function overlaps(a: Locator, b: Locator): Promise<boolean> {
  const p = (await a.boundingBox())!;
  const q = (await b.boundingBox())!;
  return p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("the aid shows by default: timing meter at the bottom, chosen strength after a key swing", async ({ page }) => {
  await practice(page);
  const canvas = page.locator("canvas");
  const meter = page.getByRole("img", { name: /timing meter/i });
  await expect(meter).toBeVisible();
  await insideViewport(page, meter);
  const v = page.viewportSize()!;
  // along the bottom, above the swing buttons
  expect((await meter.boundingBox())!.y).toBeGreaterThan(v.height / 2);
  const hard = page.getByRole("button", { name: /hard swing/i });
  expect(await overlaps(meter, hard)).toBe(false);
  await expect(canvas).toHaveAttribute("data-aid", "on");

  // keys and buttons show the chosen strength directly
  await page.keyboard.press("Digit3");
  await expect(page.locator(".aid-strength")).toHaveText("Chosen: hard");
  // clear of the stroke label, which shows for a moment after a swing
  await expect(page.locator(".stroke")).not.toBeEmpty();
  expect(await overlaps(page.locator(".aid"), page.locator(".stroke"))).toBe(false);
  await page.keyboard.press("Digit1");
  await expect(page.locator(".aid-strength")).toHaveText("Chosen: light");
  expect(await noHorizontalScroll(page)).toBe(true);

  // the meter's marker moves as the bot's serve comes at you
  await expect.poll(() => page.locator(".aid-meter").getAttribute("data-lit"), { timeout: 30_000 }).toMatch(/^(early|ontime|late)$/);
});

test("the off switch hides the meter and arcs and keeps the game playing; it is remembered", async ({ page }) => {
  await practice(page);
  const canvas = page.locator("canvas");
  const toggle = page.getByRole("button", { name: /trajectory aid/i });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await insideViewport(page, toggle);
  expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(canvas).toHaveAttribute("data-aid", "off");
  await expect(page.getByRole("img", { name: /timing meter/i })).toBeHidden();
  // nothing else depends on it: the reticle and the game run on
  await expect.poll(() => canvas.getAttribute("data-reticle")).not.toBe("");
  const frames = Number(await canvas.getAttribute("data-frames"));
  await expect.poll(async () => Number(await canvas.getAttribute("data-frames"))).toBeGreaterThan(frames + 5);
  expect(await canvas.getAttribute("data-aid-arcs")).toBe("0");
  await page.getByRole("button", { name: /leave/i }).click();
  await page.getByRole("button", { name: /practice vs bot/i }).click();
  await expect(page.getByRole("button", { name: /trajectory aid/i })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: /trajectory aid/i }).click();
  await expect(page.getByRole("img", { name: /timing meter/i })).toBeVisible();
});

test("with the camera aiming by timing, three arcs show and the lit one follows the ball; nothing covers the camera dock", async ({ page }) => {
  test.setTimeout(120_000);
  await practice(page);
  await startCamera(page);
  const canvas = page.locator("canvas");
  // the bot serves to you on alternate points; nobody swings, so each serve
  // passes through the whole window: early, on time and late each light up
  await expect.poll(() => canvas.getAttribute("data-aid-arcs"), { timeout: 30_000 }).toBe("3");
  await expect.poll(() => canvas.getAttribute("data-aid-lits"), { timeout: 60_000, intervals: [50] }).toBe("early,ontime,late");
  // light, medium and hard ticks, deeper with strength (seat 0's opponent is at -z)
  const ticks = ((await canvas.getAttribute("data-aid-ticks")) ?? "").split(",").map(Number);
  if (ticks.length === 3) expect(ticks[0]).toBeGreaterThan(ticks[2]);

  const dock = page.locator(".cam-dock");
  for (const el of [".aid", ".aid-meter", ".aid-toggle"]) expect(await overlaps(page.locator(el), dock), el).toBe(false);
  expect(await noHorizontalScroll(page)).toBe(true);

  // off: the three arcs go, the plain reticle comes back
  await page.getByRole("button", { name: /trajectory aid/i }).click();
  await expect(canvas).toHaveAttribute("data-aid-arcs", "0");
  await expect(canvas).toHaveAttribute("data-aid-lit", "");
  await page.getByRole("button", { name: /stop camera/i }).click();
});

test("the ring that marks where to stand stays up while the three arcs show, and says whether you can reach the ball", async ({ page }) => {
  test.setTimeout(90_000);
  await practice(page);
  const canvas = page.locator("canvas");
  // keys and mouse aim by timing by default, so the three arcs are what shows (no arrow held)
  await expect.poll(() => canvas.getAttribute("data-aid-arcs"), { timeout: 40_000 }).toBe("3");
  await expect.poll(() => canvas.getAttribute("data-contact"), { timeout: 40_000 }).toMatch(/^(ready|go)$/);
  // and it reports whether you can reach the ball from where you stand
  await expect.poll(() => canvas.getAttribute("data-reach"), { timeout: 40_000 }).toMatch(/^(yes|no)$/);
});

