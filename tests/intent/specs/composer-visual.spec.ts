import { expect, test, type Page } from "@playwright/test";

const VIEWPORT = { width: 1280, height: 900 } as const;
const CAPTURE_MARGIN_CSS_PX = 8;
const DEVICE_SCALE_FACTOR = 2;

test.use({
  viewport: VIEWPORT,
  deviceScaleFactor: DEVICE_SCALE_FACTOR,
  reducedMotion: "reduce",
});

async function prepareComposerCapture(
  page: Page,
  mode: "light" | "dark",
  scenario = "composer-long-input",
  expectActivityCap = false,
) {
  await page.goto(`/playground/chat?s=${scenario}`);
  const activityCap = page.locator("[data-workspace-activity-trigger]");
  await expect(activityCap).toHaveCount(expectActivityCap ? 1 : 0);

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

  let captureBounds = bounds;
  if (expectActivityCap) {
    await expect(activityCap).toBeVisible();
    const capBounds = await activityCap.boundingBox();
    expect(
      capBounds,
      "workspace activity cap must have a renderer bounding box",
    ).not.toBeNull();
    if (!capBounds) {
      throw new Error("workspace activity cap has no renderer bounding box");
    }
    expect(capBounds.x).toBeCloseTo(bounds.x, 5);
    expect(capBounds.width).toBeCloseTo(bounds.width, 5);
    expect(capBounds.y + capBounds.height).toBeCloseTo(bounds.y, 5);
    expect(await surface.evaluate((element) => getComputedStyle(element).borderTopLeftRadius))
      .toBe("0px");
    captureBounds = {
      x: Math.min(bounds.x, capBounds.x),
      y: Math.min(bounds.y, capBounds.y),
      width: Math.max(bounds.x + bounds.width, capBounds.x + capBounds.width)
        - Math.min(bounds.x, capBounds.x),
      height: Math.max(bounds.y + bounds.height, capBounds.y + capBounds.height)
        - Math.min(bounds.y, capBounds.y),
    };
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
    x: captureBounds.x - CAPTURE_MARGIN_CSS_PX,
    y: captureBounds.y - CAPTURE_MARGIN_CSS_PX,
    width: captureBounds.width + CAPTURE_MARGIN_CSS_PX * 2,
    height: captureBounds.height + CAPTURE_MARGIN_CSS_PX * 2,
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

async function expectRenderedLightDepth(
  page: Page,
  clip: Awaited<ReturnType<typeof prepareComposerCapture>>,
  { elevatedTop = true }: { elevatedTop?: boolean } = {},
) {
  const screenshot = await page.screenshot({ clip, scale: "device" });
  const raster = await page.evaluate(async (dataUrl) => {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("2D screenshot context is unavailable");
    context.drawImage(image, 0, 0);
    return {
      width: canvas.width,
      height: canvas.height,
      pixels: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data),
    };
  }, `data:image/png;base64,${screenshot.toString("base64")}`);

  const margin = CAPTURE_MARGIN_CSS_PX * DEVICE_SCALE_FACTOR;
  const sampleOffset = 2 * DEVICE_SCALE_FACTOR;
  const averageInk = (
    axis: "horizontal" | "vertical",
    fixed: number,
    start: number,
    end: number,
  ) => {
    let total = 0;
    let samples = 0;
    for (let variable = start; variable < end; variable += 2) {
      const x = axis === "horizontal" ? variable : fixed;
      const y = axis === "horizontal" ? fixed : variable;
      const pixelOffset = (y * raster.width + x) * 4;
      total += 255 - (
        raster.pixels[pixelOffset]!
        + raster.pixels[pixelOffset + 1]!
        + raster.pixels[pixelOffset + 2]!
      ) / 3;
      samples += 1;
    }
    return total / samples;
  };
  const horizontalStart = Math.floor(raster.width * 0.25);
  const horizontalEnd = Math.ceil(raster.width * 0.75);
  const verticalStart = Math.floor(raster.height * 0.25);
  const verticalEnd = Math.ceil(raster.height * 0.75);
  const outsideInk = {
    top: averageInk("horizontal", margin - sampleOffset, horizontalStart, horizontalEnd),
    right: averageInk("vertical", raster.width - margin + sampleOffset, verticalStart, verticalEnd),
    bottom: averageInk(
      "horizontal",
      raster.height - margin + sampleOffset,
      horizontalStart,
      horizontalEnd,
    ),
    left: averageInk("vertical", margin - sampleOffset, verticalStart, verticalEnd),
  };

  // Samples are two CSS pixels beyond the border box: a perimeter-only
  // implementation paints no ink there. Reading the actual browser screenshot
  // preserves the production shadow's ordering, clipping, blur, and device-scale
  // rasterization instead of replacing depth with a CSS-string assertion.
  if (elevatedTop) {
    expect(outsideInk.top).toBeGreaterThan(0.5);
  } else {
    // The attached activity cap deliberately owns only its one-pixel ring;
    // it must not grow a second elevation stack above the composite surface.
    expect(outsideInk.top).toBeLessThan(0.5);
  }
  expect(outsideInk.right).toBeGreaterThan(0.5);
  expect(outsideInk.bottom).toBeGreaterThan(0.5);
  expect(outsideInk.left).toBeGreaterThan(0.5);
}

async function expectDarwinScreenshot(
  page: Page,
  name: string,
  clip: Awaited<ReturnType<typeof prepareComposerCapture>>,
) {
  // Linux CI keeps the existing platform-specific dark golden as the negative
  // control. Light depth is asserted from real screenshot pixels above so the
  // proof is stable across native Linux font environments without replacing
  // blur/ordering semantics with a CSS-value assertion.
  if (process.platform !== "darwin") return;
  await expect(page).toHaveScreenshot(name, {
    clip,
    scale: "device",
    threshold: 0,
  });
}

test("light composer paints a complete perimeter", async ({ page }) => {
  const clip = await prepareComposerCapture(page, "light");
  await expectRenderedLightDepth(page, clip);
  await expectDarwinScreenshot(page, "composer-light.png", clip);
});

test("ordinary empty light follow-up composer reads as an available input", async ({ page }) => {
  const clip = await prepareComposerCapture(
    page,
    "light",
    "composer-follow-up-empty",
  );
  await expectRenderedLightDepth(page, clip);
  await expectDarwinScreenshot(page, "composer-follow-up-empty-light.png", clip);
});

test("light composer depth preserves the workspace activity cap seam", async ({ page }) => {
  const clip = await prepareComposerCapture(
    page,
    "light",
    "workspace-activity-card",
    true,
  );
  await expectRenderedLightDepth(page, clip, { elevatedTop: false });
  await expectDarwinScreenshot(page, "composer-activity-cap-light.png", clip);
});

test("dark composer remains unchanged", async ({ page }) => {
  const clip = await prepareComposerCapture(page, "dark");
  await expect(page).toHaveScreenshot("composer-dark.png", {
    clip,
    scale: "device",
    threshold: 0,
  });
});
