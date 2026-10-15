import { expect, test } from "@playwright/test";
import type { Browser, Locator, Page, TestInfo } from "@playwright/test";

// Task 4: the room's ready panel. Two players join by invite link, the host
// picks the format, both ready with no camera, the 3 s countdown runs and the
// match starts. The panel never covers the score bar, the timing aid, the
// camera preview or the shot label, and nothing scrolls sideways.

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function guestPage(browser: Browser, page: Page, testInfo: TestInfo): Promise<Page> {
  const mobile = testInfo.project.name === "mobile";
  const ctx = await browser.newContext({ viewport: page.viewportSize()!, isMobile: mobile, hasTouch: mobile });
  const guest = await ctx.newPage();
  await guest.goto(page.url());
  return guest;
}

/** The panel is inside the viewport and clear of every other piece of HUD that is showing. */
async function panelClear(page: Page, panel: Locator): Promise<void> {
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  const v = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(v.width);
  expect(box.y + box.height).toBeLessThanOrEqual(v.height);
  for (const sel of [".hud .score", ".aid", ".aid-meter", ".cam-dock", ".shot-label", ".controls"]) {
    for (const other of await page.locator(sel).all()) {
      if (!(await other.isVisible())) continue;
      const o = await other.boundingBox();
      if (o && o.width > 0 && o.height > 0) expect(overlaps(box, o), `ready panel covers ${sel}`).toBe(false);
    }
  }
  expect(await noHorizontalScroll(page)).toBe(true);
}

test("ready panel: host picks the format, both ready without a camera, countdown, then play", async ({ page, browser }, testInfo) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.getByRole("button", { name: /create a room/i }).click();
  await expect(page).toHaveURL(/#\/room\/[A-Z]{4}$/);
  const panel = page.getByRole("region", { name: /match setup/i });
  await expect(panel.getByRole("heading")).toHaveText(/waiting for an opponent/i);
  await expect(panel.getByRole("button", { name: "I'm ready" })).toBeDisabled();
  await panelClear(page, panel);

  const guest = await guestPage(browser, page, testInfo);
  const guestPanel = guest.getByRole("region", { name: /match setup/i });
  await expect(guestPanel.getByRole("heading")).toHaveText(/ready up/i);
  await expect(panel.getByRole("heading")).toHaveText(/ready up/i);
  // the camera is optional and the safety notice is in the panel
  await expect(guestPanel.getByText(/camera off \(optional\)/i)).toBeVisible();
  await expect(guestPanel.getByText(/before you swing/i)).toBeVisible();
  await panelClear(page, panel);
  await panelClear(guest, guestPanel);

  // only the host can pick; the guest sees the choice
  await expect(guestPanel.getByRole("radio", { name: "Best of three" })).toBeDisabled();
  await guestPanel.getByRole("button", { name: "I'm ready" }).click();
  await expect(panel.locator('li[data-seat="1"]')).toHaveAttribute("data-ready", "true");
  await panel.getByRole("radio", { name: "Best of three" }).click();
  await expect(guestPanel.getByRole("radio", { name: "Best of three" })).toHaveAttribute("aria-checked", "true");
  // changing the format cleared the guest's ready
  await expect(guestPanel.locator('li[data-seat="1"]')).toHaveAttribute("data-ready", "false");
  await expect(guestPanel.getByRole("button", { name: "I'm ready" })).toBeVisible();

  await guestPanel.getByRole("button", { name: "I'm ready" }).click();
  await panel.getByRole("button", { name: "I'm ready" }).click();
  await expect(panel.getByRole("heading")).toHaveText(/starting in [123]/i);
  await panelClear(page, panel);
  // un-ready stops it
  await panel.getByRole("button", { name: "Not ready" }).click();
  await expect(panel.getByRole("heading")).toHaveText(/ready up/i);
  await panel.getByRole("button", { name: "I'm ready" }).click();
  await expect(panel).toBeHidden({ timeout: 6000 });
  await expect(guestPanel).toBeHidden();
  await expect(page.locator(".hud .score .sb-format")).toHaveText("Best of three");
  await guest.context().close();
});

test("the ready panel stays clear of the camera preview", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.getByRole("button", { name: /create a room/i }).click();
  const panel = page.getByRole("region", { name: /match setup/i });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: /set up camera/i }).click();
  const setup = page.getByRole("dialog", { name: /camera setup/i });
  await setup.getByRole("button", { name: "Got it" }).click();
  await setup.getByRole("button", { name: /start camera/i }).click();
  await expect(setup.getByRole("heading", { name: /can we see you/i })).toBeVisible({ timeout: 40_000 });
  await setup.getByRole("button", { name: "Skip check" }).click();
  await expect(setup).toBeHidden();
  await expect(page.locator("video.selfview")).toBeVisible();
  // the fake webcam has nobody in it
  await expect(panel.getByText(/camera on, can't see you yet/i)).toBeVisible();
  await panelClear(page, panel);
});

test("practice vs bot has no ready panel: it starts at once", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /practice vs bot/i }).click();
  await expect(page.locator("canvas")).toBeVisible();
  await expect.poll(async () => Number(await page.locator("canvas").getAttribute("data-tick")), { timeout: 10_000 }).toBeGreaterThan(30);
  await expect(page.getByRole("region", { name: /match setup/i })).toBeHidden();
});
