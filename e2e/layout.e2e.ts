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
  const swing = page.getByRole("button", { name: /swing/i });
  await expect(swing).toBeVisible();
  const swingBox = (await swing.boundingBox())!;
  expect(swingBox.y + swingBox.height).toBeLessThanOrEqual(viewport.height);
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("a swing by keyboard does not break the game", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /practice vs bot/i }).click();
  await expect(page.locator("canvas")).toBeVisible();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: /leave/i }).click();
  await expect(page.getByRole("button", { name: /practice vs bot/i })).toBeVisible();
});
