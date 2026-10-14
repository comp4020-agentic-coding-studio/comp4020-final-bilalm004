import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// Task 1: the score bar at the top of the game screen, driven by the server's
// score. In practice the player never swings here, so points are won and lost
// on their own within a few seconds (unreturned serves, the bot's returns).

async function practice(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /practice vs bot/i }).click();
  await expect(page.locator(".hud .score")).toBeVisible();
}

/** Waits for the first point (not a fault) to be called. */
async function firstPoint(page: Page): Promise<string> {
  const call = page.locator(".hud .score .sb-call");
  await expect(call).toHaveText(/^(15-0|0-15|Double fault)$/, { timeout: 40_000 });
  return (await call.textContent()) ?? "";
}

test("score bar shows names, points, games, sets, server and format, and announces a point", async ({ page }) => {
  test.setTimeout(90_000);
  await practice(page);
  const bar = page.locator(".hud .score");
  const call = bar.locator(".sb-call");
  await expect(call).toHaveAttribute("aria-live", "polite");

  const rows = bar.locator(".sb-row");
  await expect(rows.nth(0).locator(".sb-name")).toHaveText("You");
  await expect(rows.nth(1).locator(".sb-name")).toHaveText("Bot");
  for (const field of ["sets", "games", "points"]) {
    await expect(rows.nth(0).locator(`[data-field=${field}]`)).toHaveText("0");
    await expect(rows.nth(1).locator(`[data-field=${field}]`)).toHaveText("0");
  }
  // you serve first; the format is shown
  await expect(rows.nth(0)).toHaveAttribute("data-serving", "true");
  await expect(rows.nth(1)).toHaveAttribute("data-serving", "false");
  await expect(bar.locator(".sb-format")).toHaveText("Practice");

  // the bar sits at the top, inside the viewport, above the controls and
  // above where the camera preview docks
  const v = page.viewportSize()!;
  const box = (await bar.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(v.width);
  expect(box.y + box.height).toBeLessThanOrEqual(v.height * 0.25);
  const hudBottom = await page.locator(".hud").evaluate((el) => el.getBoundingClientRect().bottom);
  const dockTop = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "cam-dock";
    document.querySelector(".game")!.append(probe);
    const top = probe.getBoundingClientRect().top;
    probe.remove();
    return top;
  });
  expect(hudBottom).toBeLessThanOrEqual(dockTop);
  const controls = (await page.locator(".controls").boundingBox())!;
  expect(box.y + box.height).toBeLessThan(controls.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // the first point, called as tennis calls it, and the changed number pulses
  const said = await firstPoint(page);
  const points = await rows.locator("[data-field=points]").allTextContents();
  expect(points.sort()).toEqual(["0", "15"]);
  if (said !== "Double fault") {
    const pulsing = bar.locator(".sb-pulse");
    await expect(pulsing).toHaveCount(1);
    await expect(pulsing).toHaveText("15");
    expect(await pulsing.evaluate((el) => getComputedStyle(el).animationName)).toBe("sb-pulse");
  }
  // the call clears after about two seconds
  await expect(call).toHaveText("", { timeout: 4000 });
});

test("with reduced motion the changed number doesn't pulse", async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const mobile = testInfo.project.name === "mobile";
  const context = await browser.newContext({
    viewport: testInfo.project.use.viewport,
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await practice(page);
  await firstPoint(page);
  const animations = await page.locator(".hud .score .sb-num").evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName));
  expect(animations.every((a) => a === "none")).toBe(true);
  await context.close();
});
