import { expect, test, type Page } from "@playwright/test";

const PROMPTS = [
  "Explain how the codebase works",
  "Build a new feature or tool",
  "Review changes and suggest fixes",
  "Fix failing tests and issues",
] as const;

const VIEWPORTS = {
  wide: { width: 1280, height: 900, columns: 4 },
  narrow: { width: 480, height: 800, columns: 2 },
} as const;

test.use({
  viewport: VIEWPORTS.wide,
  deviceScaleFactor: 2,
  reducedMotion: "reduce",
});

async function openFixture(
  page: Page,
  viewport: (typeof VIEWPORTS)[keyof typeof VIEWPORTS],
  mode: "light" | "dark" = "light",
) {
  await page.setViewportSize(viewport);
  await page.goto("/playground/home-suggestions");
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
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.mode))
    .toBe(mode);
  await expect(page.locator("[data-home-suggestions-playground]")).toBeVisible();
  await expect(page.locator("[data-home-suggestion-grid]")).toBeVisible();
}

async function expectCollapsedSelectionAtEnd(page: Page, expected: string) {
  const state = await page.locator("[data-home-composer-editor]").evaluate((editor) => {
    const selection = window.getSelection();
    if (!selection?.anchorNode) return null;
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.setEnd(selection.anchorNode, selection.anchorOffset);
    return {
      collapsed: selection.isCollapsed,
      offset: range.toString().length,
      textLength: editor.textContent?.length ?? 0,
    };
  });
  expect(state).toEqual({
    collapsed: true,
    offset: expected.length,
    textLength: expected.length,
  });
}

test("suggestions replace the real Home draft without submitting", async ({ page }) => {
  await openFixture(page, VIEWPORTS.wide);
  const buttons = page.locator("[data-home-suggestion-grid]").getByRole("button");
  await expect(buttons).toHaveCount(PROMPTS.length);
  for (const [index, prompt] of PROMPTS.entries()) {
    await expect(buttons.nth(index)).toHaveAccessibleName(prompt);
  }

  const editor = page.locator("[data-home-composer-editor]");
  await expect(editor).toBeFocused();
  await editor.evaluate((element) => (element as HTMLElement).blur());
  for (let index = 0; index < PROMPTS.length; index += 1) {
    await page.keyboard.press("Tab");
    await expect(buttons.nth(index)).toBeFocused();
  }

  await editor.fill("replace this draft");
  await buttons.nth(0).click();
  await expect(editor).toHaveText(PROMPTS[0]);
  await expect(editor).toBeFocused();
  await expectCollapsedSelectionAtEnd(page, PROMPTS[0]);

  await buttons.nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(editor).toHaveText(PROMPTS[1]);
  await expect(editor).toBeFocused();
  await expectCollapsedSelectionAtEnd(page, PROMPTS[1]);

  await buttons.nth(2).focus();
  await page.keyboard.press("Space");
  await expect(editor).toHaveText(PROMPTS[2]);
  await expect(editor).toBeFocused();
  await expectCollapsedSelectionAtEnd(page, PROMPTS[2]);

  await buttons.nth(0).click();
  await editor.press("ArrowLeft");
  await editor.press("ArrowLeft");
  await buttons.nth(0).click();
  await expect(editor).toHaveText(PROMPTS[0]);
  await expect(editor).toBeFocused();
  await expectCollapsedSelectionAtEnd(page, PROMPTS[0]);
  await expect(page.locator("[data-home-suggestion-submit-count]")).toHaveText("0");
});

for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
  for (const mode of ["light", "dark"] as const) {
    test(`${viewportName} ${mode} suggestion geometry`, async ({ page }) => {
      await openFixture(page, viewport, mode);
      const grid = page.locator("[data-home-suggestion-grid]");
      const columnCount = await grid.evaluate((element) => (
        getComputedStyle(element).gridTemplateColumns.split(" ").length
      ));
      expect(columnCount).toBe(viewport.columns);

      const cardRegion = page.locator("[data-home-card-region]");
      const composerDock = page.locator("[data-home-composer-dock]");
      const [cardBounds, dockBounds] = await Promise.all([
        cardRegion.boundingBox(),
        composerDock.boundingBox(),
      ]);
      expect(cardBounds).not.toBeNull();
      expect(dockBounds).not.toBeNull();
      expect(cardBounds!.x).toBeGreaterThanOrEqual(0);
      expect(cardBounds!.y).toBeGreaterThanOrEqual(0);
      expect(cardBounds!.x + cardBounds!.width).toBeLessThanOrEqual(viewport.width);
      expect(cardBounds!.y + cardBounds!.height).toBeLessThanOrEqual(viewport.height);
      expect(cardBounds!.y + cardBounds!.height).toBeLessThanOrEqual(dockBounds!.y);

      if (process.platform === "darwin") {
        await expect(page).toHaveScreenshot(
          `home-suggestions-${viewportName}-${mode}.png`,
          { threshold: 0 },
        );
      }
    });
  }
}
