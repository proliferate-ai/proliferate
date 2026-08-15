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

  // The selector controls and route footer are dev-only playground chrome,
  // not part of the production composer depth path. Remove only that chrome
  // from layout so the unchanged dock and surface fit inside the playground's
  // real overflow-clipping main region at the pinned viewport.
  await page.addStyleTag({
    content: `
      .chat-selection-root > header,
      .chat-selection-root > footer {
        display: none !important;
      }
    `,
  });
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

  const geometry = await surface.evaluate(async (element) => {
    const toRect = (rect: DOMRectReadOnly) => ({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
    const intersection = await new Promise<DOMRectReadOnly>((resolve) => {
      const observer = new IntersectionObserver(([entry]) => {
        if (!entry) return;
        observer.disconnect();
        resolve(entry.intersectionRect);
      }, { threshold: [0, 1] });
      observer.observe(element);
    });

    let visibleLeft = 0;
    let visibleTop = 0;
    let visibleRight = window.innerWidth;
    let visibleBottom = window.innerHeight;
    const clippingAncestors: Array<{
      element: string;
      overflowX: string;
      overflowY: string;
      clip: { left: number; top: number; right: number; bottom: number };
    }> = [];

    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      const clipsX = style.overflowX !== "visible";
      const clipsY = style.overflowY !== "visible";
      if (!clipsX && !clipsY) continue;

      const rect = ancestor.getBoundingClientRect();
      const clip = {
        left: rect.left + ancestor.clientLeft,
        top: rect.top + ancestor.clientTop,
        right: rect.left + ancestor.clientLeft + ancestor.clientWidth,
        bottom: rect.top + ancestor.clientTop + ancestor.clientHeight,
      };
      clippingAncestors.push({
        element: ancestor.tagName.toLowerCase(),
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        clip,
      });
      if (clipsX) {
        visibleLeft = Math.max(visibleLeft, clip.left);
        visibleRight = Math.min(visibleRight, clip.right);
      }
      if (clipsY) {
        visibleTop = Math.max(visibleTop, clip.top);
        visibleBottom = Math.min(visibleBottom, clip.bottom);
      }
    }

    return {
      intersection: toRect(intersection),
      clippingAncestors,
      visibleClippingRegion: {
        left: visibleLeft,
        top: visibleTop,
        right: visibleRight,
        bottom: visibleBottom,
      },
    };
  });

  expect(
    geometry.intersection,
    "the rendered intersection must equal the complete surface bounds",
  ).toEqual(bounds);

  const clip = {
    x: bounds.x - CAPTURE_MARGIN_CSS_PX,
    y: bounds.y - CAPTURE_MARGIN_CSS_PX,
    width: bounds.width + CAPTURE_MARGIN_CSS_PX * 2,
    height: bounds.height + CAPTURE_MARGIN_CSS_PX * 2,
  };

  // This is the production dock/surface renderer path, not a depth test double:
  // the expanded clip preserves its real ordering, occlusion, clipping, radius,
  // and device-scale rasterization while requiring canvas beyond every edge.
  expect(
    geometry.clippingAncestors.length,
    "the real playground overflow-clipping ancestor must remain active",
  ).toBeGreaterThan(0);
  expect(clip.x).toBeGreaterThanOrEqual(geometry.visibleClippingRegion.left);
  expect(clip.y).toBeGreaterThanOrEqual(geometry.visibleClippingRegion.top);
  expect(clip.x + clip.width).toBeLessThanOrEqual(
    geometry.visibleClippingRegion.right,
  );
  expect(clip.y + clip.height).toBeLessThanOrEqual(
    geometry.visibleClippingRegion.bottom,
  );

  return clip;
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
