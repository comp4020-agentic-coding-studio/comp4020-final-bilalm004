import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// Task 2: auto-move. The movement-mode toggle sits under the camera preview
// (in .cam-dock), says auto by default, is remembered per viewer, and the
// server applies it to your seat. Runs with Chrome's fake webcam: nobody is in
// it, so the camera runs but nothing is tracked.

interface Seen {
  sent: Record<string, unknown>[];
  modes: string[];
}

async function practice(page: Page): Promise<Seen> {
  const seen: Seen = { sent: [], modes: [] };
  page.on("websocket", (ws) => {
    ws.on("framesent", (f) => seen.sent.push(JSON.parse(String(f.payload))));
    ws.on("framereceived", (f) => {
      const m = JSON.parse(String(f.payload));
      if (m.t === "state") seen.modes.push(m.state.movement[0].mode);
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /practice vs bot/i }).click();
  await expect(page.locator("canvas")).toBeVisible();
  return seen;
}

async function startCamera(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Camera", exact: true }).click();
  const panel = page.getByRole("dialog", { name: /camera setup/i });
  await panel.getByRole("button", { name: "Got it" }).click();
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

test("auto is the default: sent on joining with no camera, and the server has the seat in auto", async ({ page }) => {
  const seen = await practice(page);
  await expect.poll(() => seen.sent.filter((m) => m.t === "mode").map((m) => m.mode)).toEqual(["auto"]);
  await expect.poll(() => seen.modes.at(-1)).toBe("auto");
  // the keyboard keeps its own movement alongside auto
  await page.keyboard.down("KeyD");
  await expect.poll(() => seen.sent.some((m) => m.t === "move")).toBe(true);
  await page.keyboard.up("KeyD");
});

test("the movement toggle under the preview: auto by default, switches to lean, remembered, clear of the HUD", async ({ page }) => {
  test.setTimeout(120_000);
  const seen = await practice(page);
  await startCamera(page);
  const toggle = page.getByRole("button", { name: /movement mode/i });
  await expect(toggle).toHaveText("Move: auto");
  await insideViewport(page, toggle);
  expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // the lean gauge is dimmed while it doesn't move you
  const gauge = page.locator(".tilt-gauge");
  expect(Number(await gauge.evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(0.5);

  // clear of the score bar, the timing meter, the swing buttons and the shot label
  const others = [".hud .score", ".aid", ".controls"];
  for (const sel of others) expect(await overlaps(toggle, page.locator(sel)), sel).toBe(false);
  // the shot label shows for about a second after a swing: measure it and the dock together
  await page.keyboard.press("Digit2");
  const labelHitsDock = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const check = () => {
          const label = document.querySelector(".shot-label") as HTMLElement;
          if (label.hidden) return requestAnimationFrame(check);
          const p = label.getBoundingClientRect();
          const q = document.querySelector(".cam-dock")!.getBoundingClientRect();
          resolve(p.left < q.right && q.left < p.right && p.top < q.bottom && q.top < p.bottom);
        };
        check();
      }),
  );
  expect(labelHitsDock).toBe(false);
  expect(await noHorizontalScroll(page)).toBe(true);

  await toggle.click();
  await expect(toggle).toHaveText("Move: lean");
  expect(Number(await gauge.evaluate((el) => getComputedStyle(el).opacity))).toBe(1);
  await expect.poll(() => seen.sent.filter((m) => m.t === "mode").map((m) => m.mode)).toEqual(["auto", "tilt"]);
  await expect.poll(() => seen.modes.at(-1)).toBe("tilt");
  await page.getByRole("button", { name: /stop camera/i }).click();

  // remembered: the next room starts in lean
  await page.getByRole("button", { name: /leave/i }).click();
  seen.sent.length = 0;
  await page.getByRole("button", { name: /practice vs bot/i }).click();
  await expect.poll(() => seen.sent.filter((m) => m.t === "mode").map((m) => m.mode)).toEqual(["tilt"]);
  await expect.poll(() => seen.modes.at(-1)).toBe("tilt");
});

test("with localStorage blocked the game still starts in auto", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
  });
  const seen = await practice(page);
  await expect.poll(() => seen.sent.filter((m) => m.t === "mode").map((m) => m.mode)).toEqual(["auto"]);
});
