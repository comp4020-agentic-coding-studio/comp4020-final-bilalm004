import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// Task 13: the Wii-style home screen. Runs at both viewports (desktop and
// mobile projects in playwright.config.ts).

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

function sentMessages(page: Page): Record<string, unknown>[] {
  const sent: Record<string, unknown>[] = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => sent.push(JSON.parse(String(f.payload)))));
  return sent;
}

test("title, then the sport preview, then the sport buttons, all on screen", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/playing as/i)).toBeVisible();
  const title = page.getByRole("heading", { level: 1, name: "Weblympics" });
  const thumb = page.getByRole("img", { name: /tennis preview/i });
  const sports = page.getByRole("group", { name: "Sports" });
  const tennis = sports.getByRole("button", { name: /tennis/i });
  for (const el of [title, thumb, tennis]) await expect(el).toBeVisible();

  const [t, p, s] = [(await title.boundingBox())!, (await thumb.boundingBox())!, (await sports.boundingBox())!];
  expect(t.y + t.height).toBeLessThanOrEqual(p.y);
  expect(p.y + p.height).toBeLessThanOrEqual(s.y);

  // every sport button and every action sits inside the viewport width, and
  // Tennis's options fit the first screen
  const viewport = page.viewportSize()!;
  const reachable = [
    ...(await sports.getByRole("button").all()),
    page.getByRole("button", { name: /practice vs bot/i }),
    page.getByRole("button", { name: /create a room/i }),
    page.getByRole("button", { name: "Join" }),
  ];
  for (const el of reachable) {
    const b = (await el.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(viewport.width);
    expect(b.y + b.height).toBeLessThanOrEqual(viewport.height);
    expect(b.height).toBeGreaterThanOrEqual(44);
  }
  expect(await noHorizontalScroll(page)).toBe(true);
  // the menu never loads the 3D engine (no canvas until a game starts)
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("arrow keys move between sports and the preview follows", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/playing as/i)).toBeVisible();
  const sports = page.getByRole("group", { name: "Sports" });
  const buttons = sports.getByRole("button");
  const count = await buttons.count();

  // the sport group is a single Tab stop that lands on the selected sport
  await sports.getByRole("button", { name: /tennis/i }).focus();
  await expect(page.locator(".sport:focus")).toHaveAttribute("data-sport", "tennis");
  await expect(page.locator(".sport:focus .pointer")).toBeVisible();

  await page.keyboard.press("ArrowDown");
  const second = await buttons.nth(1).getAttribute("data-sport");
  await expect(page.locator(".sport:focus")).toHaveAttribute("data-sport", second!);
  const name = (await buttons.nth(1).locator(".sport-name").textContent())!;
  await expect(page.getByRole("img", { name: new RegExp(`${name} preview`, "i") })).toBeVisible();

  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".sport:focus")).toHaveAttribute("data-sport", "tennis");
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".sport:focus")).toHaveAttribute("data-sport", (await buttons.nth(count - 1).getAttribute("data-sport"))!);
  await page.keyboard.press("Home");
  await expect(page.locator(".sport:focus")).toHaveAttribute("data-sport", "tennis");

  // Tab leaves the group for the selected sport's options
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: /practice vs bot/i })).toBeFocused();
});

test("Enter on Tennis opens its options and practice starts exactly as before", async ({ page }) => {
  const sent = sentMessages(page);
  await page.goto("/");
  await expect(page.getByText(/playing as/i)).toBeVisible();
  await page.getByRole("group", { name: "Sports" }).getByRole("button", { name: /tennis/i }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /practice vs bot/i })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("canvas")).toBeVisible();
  expect(sent.find((m) => m.t === "create")).toEqual({ t: "create", game: "tennis", practice: true });
});

test("coming-soon sports can't be activated and never reach the server", async ({ page }) => {
  const sent = sentMessages(page);
  await page.goto("/");
  await expect(page.getByText(/playing as/i)).toBeVisible();
  const placeholders = page.locator('.sport[aria-disabled="true"]');
  const n = await placeholders.count();
  for (let i = 0; i < n; i++) {
    const b = placeholders.nth(i);
    // named placeholders say so; the ?? tiles keep their secret
    if ((await b.locator(".sport-name").textContent()) === "??") await expect(b).not.toContainText(/coming soon/i);
    else await expect(b).toContainText(/coming soon/i);
    await expect(b).toHaveAttribute("tabindex", "-1");
    // screen readers and Playwright see it as disabled; force a real click anyway
    await expect(b).toBeDisabled();
    await b.click({ force: true });
    await b.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
  }
  await page.waitForTimeout(300);
  expect(sent.filter((m) => m.t === "create" || m.t === "join")).toEqual([]);
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /practice vs bot/i })).toBeVisible();
  // only playable sports are pressable; the placeholders carry no pressed state
  await expect(page.locator('.sport[aria-pressed="true"]')).toHaveAttribute("data-sport", "tennis");
});

test("the sports are Tennis, Bowling, Archery and two ?? tiles, in that order", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/playing as/i)).toBeVisible();
  await expect(page.locator(".sport .sport-name")).toHaveText(["Tennis", "Bowling", "Archery", "??", "??"]);
});

test("every current action is still on the home screen", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/playing as/i)).toBeVisible();
  for (const name of [/practice vs bot/i, /create a room/i, /^join$/i, /sign in as demo one/i, /sign in as demo two/i]) {
    await expect(page.getByRole("button", { name })).toBeVisible();
  }
  await expect(page.getByRole("textbox", { name: /room code/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /what makes this good/i })).toHaveAttribute("href", "/readme/");
  await page.getByRole("button", { name: /sign in as demo one/i }).click();
  await expect(page.getByRole("button", { name: /play as guest/i })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
});
