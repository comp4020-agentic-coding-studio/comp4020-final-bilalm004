import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// Task 6: forehand and backhand look different, and a FOREHAND / BACKHAND
// label shows on each shot without covering the court or the camera dock.

type Box = { x: number; y: number; width: number; height: number };

const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The court's lines on screen, as the view measured them from its camera. */
async function court(page: Page): Promise<Box> {
  const [l, t, r, b] = (await page.locator("canvas").getAttribute("data-court"))!.split(",").map(Number);
  return { x: l, y: t, width: r - l, height: b - t };
}

/** The label is visible, inside the viewport and clear of the court and the HUD around it. */
async function labelClear(page: Page, label: Locator, also: Locator[] = []): Promise<void> {
  await expect(label).toBeVisible();
  const box = (await label.boundingBox())!;
  const v = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(v.width);
  expect(box.y + box.height).toBeLessThanOrEqual(v.height);
  expect(overlaps(box, await court(page)), "label covers the court").toBe(false);
  for (const other of [page.locator(".controls"), page.locator(".stroke"), ...also]) {
    const o = await other.boundingBox();
    if (o) expect(overlaps(box, o), `label covers ${await other.getAttribute("class")}`).toBe(false);
  }
}

async function practice(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /practice vs bot/i }).click();
  await expect(page.locator("canvas")).toBeVisible();
  await expect.poll(async () => Number(await page.locator("canvas").getAttribute("data-frames"))).toBeGreaterThan(5);
}

test("a swing shows FOREHAND or BACKHAND clear of the court, and the two strokes differ on screen", async ({ page }) => {
  await practice(page);
  const label = page.locator(".shot-label");
  await page.keyboard.press("Space");
  await expect(label.locator("b")).toHaveText(/^(FOREHAND|BACKHAND)$/);
  await expect(label).toHaveAttribute("data-seat", "0");
  await labelClear(page, label);

  // the racket head on screen, relative to the player, at the start, contact
  // and end of each stroke, measured from the posed character in this view
  const raw = await page.locator("canvas").getAttribute("data-stroke0");
  const { forehand, backhand } = JSON.parse(raw!) as Record<"forehand" | "backhand", [number, number][]>;
  // taken back and met on opposite sides of the player
  expect(forehand[0][0]).toBeGreaterThan(0);
  expect(backhand[0][0]).toBeLessThan(0);
  expect(forehand[1][0]).toBeGreaterThan(0);
  expect(backhand[1][0]).toBeLessThan(0);
  // and finished on opposite sides, the other way round
  expect(forehand[2][0]).toBeLessThan(backhand[2][0]);
  // far enough apart to see at this size: the contact points are at least
  // half the contact height apart (the old strokes met the ball almost
  // dead centre, a few pixels apart). Scaled by the player, not the screen.
  const contactHeight = -forehand[1][1];
  expect(contactHeight).toBeGreaterThan(20);
  expect(forehand[1][0] - backhand[1][0]).toBeGreaterThan(contactHeight * 0.5);
});

test("the opponent's shots are labelled too", async ({ page }) => {
  await practice(page);
  // the bot returns the serve; its label says who played it
  await expect(page.locator('.shot-label[data-seat="1"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".shot-label b")).toHaveText(/^(FOREHAND|BACKHAND)$/);
  await expect(page.locator(".shot-label span")).toHaveText("Bot");
  await labelClear(page, page.locator(".shot-label"));
});

test("the joining player (seat 1) gets the label on their side of the arena", async ({ page, browser }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: /create/i }).first().click();
  await expect(page).toHaveURL(/#\/room\/[A-Z]{4}$/);
  const mobile = testInfo.project.name === "mobile";
  const guestContext = await browser.newContext({ viewport: page.viewportSize()!, isMobile: mobile, hasTouch: mobile });
  const guest = await guestContext.newPage();
  await guest.goto(page.url());
  // two software-rendered pages at once: frames come slowly
  await expect.poll(async () => Number(await guest.locator("canvas").getAttribute("data-frames")), { timeout: 15_000 }).toBeGreaterThan(5);
  await guest.getByRole("button", { name: /medium swing/i }).click();
  await expect(guest.locator(".shot-label")).toHaveAttribute("data-seat", "1");
  await labelClear(guest, guest.locator(".shot-label"));
  const stroke = JSON.parse((await guest.locator("canvas").getAttribute("data-stroke1"))!);
  expect(stroke.forehand[1][0]).toBeGreaterThan(0);
  expect(stroke.backhand[1][0]).toBeLessThan(0);
  await guestContext.close();
});

test("the label stays clear of the camera dock", async ({ page }) => {
  test.setTimeout(60_000);
  await practice(page);
  await page.getByRole("button", { name: "Camera", exact: true }).click();
  const panel = page.getByRole("dialog", { name: /camera setup/i });
  await panel.getByRole("button", { name: "Got it" }).click();
  await panel.getByRole("button", { name: /start camera/i }).click();
  await expect(panel.getByRole("heading", { name: /can we see you/i })).toBeVisible({ timeout: 40_000 });
  await panel.getByRole("button", { name: "Skip check" }).click();
  await expect(panel).toBeHidden();
  await expect(page.locator("video.selfview")).toBeVisible();
  await page.keyboard.press("Space");
  await labelClear(page, page.locator(".shot-label"), [page.locator(".cam-dock")]);
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the label still shows, without the pop-in", async ({ page }) => {
    await practice(page);
    await page.keyboard.press("Space");
    const label = page.locator(".shot-label");
    await expect(label).toBeVisible();
    expect(await label.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  });
});

test("with motion allowed, the label pops in", async ({ page }) => {
  await practice(page);
  await page.keyboard.press("Space");
  const label = page.locator(".shot-label");
  await expect(label).toBeVisible();
  expect(await label.evaluate((el) => getComputedStyle(el).animationName)).toMatch(/^shot-(pop|shake)$/);
});
