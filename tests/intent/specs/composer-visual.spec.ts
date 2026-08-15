import { expect, test, type Page } from "@playwright/test";

const VIEWPORT = { width: 1280, height: 900 } as const;
const CAPTURE_MARGIN_CSS_PX = 8;

test.use({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  reducedMotion: "reduce",
});

async function prepareComposerCapture(page: Page, mode: "light" | "dark") {
  await page.goto("/playground/chat?s=composer-long-input");
  await expect(page.locator("[data-workspace-activity-trigger]")).toHaveCount(0);

  await page.evaluate((resolvedMode) => {
    document.documentElement.dataset.mode = resolvedMode;
  }, mode);
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        caret-color: transparent !important;
        transition: none !important;
      }
    `,
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });

  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.mode))
    .toBe(mode);

  const surface = page.locator('[data-chat-composer-surface="true"]');
  await expect(surface).toHaveCount(1);
  await expect(surface).toBeVisible();
  const bounds = await surface.boundingBox();
  expect(bounds, "composer surface must have a renderer bounding box").not.toBeNull();
  if (!bounds) {
    throw new Error("composer surface has no renderer bounding box");
  }

  // This is the production dock/surface renderer path, not a depth test double:
  // the expanded clip preserves its real ordering, occlusion, clipping, radius,
  // and device-scale rasterization while requiring canvas beyond every edge.
  expect(bounds.x).toBeGreaterThanOrEqual(CAPTURE_MARGIN_CSS_PX);
  expect(bounds.y).toBeGreaterThanOrEqual(CAPTURE_MARGIN_CSS_PX);
  expect(VIEWPORT.width - (bounds.x + bounds.width)).toBeGreaterThanOrEqual(
    CAPTURE_MARGIN_CSS_PX,
  );
  expect(VIEWPORT.height - (bounds.y + bounds.height)).toBeGreaterThanOrEqual(
    CAPTURE_MARGIN_CSS_PX,
  );

  return {
    x: bounds.x - CAPTURE_MARGIN_CSS_PX,
    y: bounds.y - CAPTURE_MARGIN_CSS_PX,
    width: bounds.width + CAPTURE_MARGIN_CSS_PX * 2,
    height: bounds.height + CAPTURE_MARGIN_CSS_PX * 2,
  };
}

test("light composer paints a complete perimeter", async ({ page }) => {
  const clip = await prepareComposerCapture(page, "light");
  await expect(page).toHaveScreenshot("composer-light.png", {
    clip,
    scale: "device",
    threshold: 0,
  });
});

test("dark composer remains unchanged", async ({ page }) => {
  const clip = await prepareComposerCapture(page, "dark");
  await expect(page).toHaveScreenshot("composer-dark.png", {
    clip,
    scale: "device",
    threshold: 0,
  });
});
