import { expect, test, type Page } from "@playwright/test";
import {
  FIXTURE_BINARY_PATH,
  FIXTURE_LONG_PATH,
  FIXTURE_MARKDOWN_PATH,
  FIXTURE_SEARCH_MATCHES_PATH,
  FIXTURE_TOO_LARGE_PATH,
} from "../src/file-tree-fixture";

/**
 * Viewer-header search-focus and open-in qualification suite (spec
 * "02B - Viewer Header Search Focus and Open In", "Tests and qualification").
 * Extends the same `/playground/files` fixture host as
 * `file-reference-routing.spec.ts` and `file-tree-dock.spec.ts`: one
 * production `WorkspaceShellRightRail` -> `RightPanel` -> `FileEditorView` ->
 * `FileViewerFrame` chain. New file-content variants (markdown, multi-match
 * source, too-large, binary, a deep long path) are opened directly via
 * `?path=…` — see `main.tsx`'s `FIXTURE_FILE_CONTENTS` — and are
 * deliberately outside `file-tree-fixture.ts`'s `DIRECTORY_ENTRIES` so this
 * suite cannot perturb `file-tree-dock.spec.ts`'s tree screenshots.
 *
 * Chromium-only (`playwright.config.ts`'s sole configured project).
 */

const BASE = "/playground/files";

test.describe("header composition and breadcrumbs", () => {
  test("36px header, Files crumb, inert basename, no absolute root", async ({ page }) => {
    await openFixture(page, `${BASE}?case=workspace-file`);
    const toolbar = page.locator("[data-file-viewer-toolbar]");
    await expect(toolbar).toBeVisible();
    expect(await toolbar.evaluate((el) => el.getBoundingClientRect().height)).toBe(36);

    const nav = page.getByRole("navigation", { name: "File path" });
    await expect(nav.getByRole("button", { name: "Files" })).toBeVisible();
    // The final basename is inert text, never a button.
    await expect(nav.getByRole("button", { name: "example.ts" })).toHaveCount(0);
    await expect(nav.getByText("example.ts")).toBeVisible();

    const navText = (await nav.textContent()) ?? "";
    expect(navText).not.toContain("/fixture-workspace");
    expect(navText).not.toContain("/Users/");
    await screenshot(page, "header-workspace-file");
  });

  test("long workspace-relative path truncates and directory crumbs reveal the dock", async ({ page }) => {
    await openFixture(page, `${BASE}?case=workspace-file&path=${encodeURIComponent(FIXTURE_LONG_PATH)}`);
    const nav = page.getByRole("navigation", { name: "File path" });
    await expect(nav.getByText("breadcrumb-truncation-target.ts")).toBeVisible();
    // Truncation is horizontal overflow within the flex remainder, not a
    // shrunk header — the header stays exactly 36px regardless of path length.
    expect(
      await page.locator("[data-file-viewer-toolbar]").evaluate((el) => el.getBoundingClientRect().height),
    ).toBe(36);
    await screenshot(page, "header-long-path-truncation");

    await nav.getByRole("button", { name: "src" }).click();
    await expect(page.locator("[data-docked-file-tree]")).toBeVisible();
    await expect(page.getByRole("treeitem", { name: "index.ts" })).toBeVisible();
  });
});

test.describe("options menu", () => {
  test("source file: Copy content, Copy path, word wrap, no rich preview", async ({ page }) => {
    await openFixture(page, `${BASE}?case=workspace-file`);
    const menu = await openOptionsMenu(page);
    const items = menu.getByRole("button");
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toHaveText("Copy content");
    await expect(items.nth(1)).toHaveText("Copy path");
    await expect(items.nth(2)).toHaveText("Enable word wrap");
    await expect(menu.getByRole("button", { name: /rich preview/i })).toHaveCount(0);
    await screenshot(page, "options-menu-source");
  });

  test("markdown file: rich preview item present, order preserved", async ({ page }) => {
    await openFixture(page, `${BASE}?case=workspace-file&path=${encodeURIComponent(FIXTURE_MARKDOWN_PATH)}`);
    const menu = await openOptionsMenu(page);
    const items = menu.getByRole("button");
    await expect(items.nth(0)).toHaveText("Copy content");
    await expect(items.nth(1)).toHaveText("Copy path");
    await expect(items.nth(2)).toHaveText("Enable word wrap");
    // Rendered mode is the default for markdown, so the toggle offers "Disable".
    await expect(items.nth(3)).toHaveText("Disable rich preview");
    await screenshot(page, "options-menu-markdown");
  });

  test("Copy content and Copy path call the capability-bound clipboard action exactly", async ({ page }) => {
    await openFixture(page, `${BASE}?case=workspace-file`);
    let menu = await openOptionsMenu(page);
    await menu.getByRole("button", { name: "Copy content" }).click();
    let snapshot = await fixtureSnapshot(page);
    expect(snapshot.counters.clipboard).toBe(1);

    menu = await openOptionsMenu(page);
    await menu.getByRole("button", { name: "Copy path" }).click();
    snapshot = await fixtureSnapshot(page);
    expect(snapshot.counters.clipboard).toBe(2);
    // Copy path never derives a native path from breadcrumb text; the fixture
    // workspace has no companion path resolved here beyond src/example.ts.
    expect(snapshot.clipboardValues[1]).not.toContain("/Users/");
  });
});

test.describe("open-in split action", () => {
  test("local-companion desktop workspace file renders the split button with exact label", async ({ page }) => {
    await openFixture(page, `${BASE}?host=desktop&origin=local&case=workspace-file`);
    const openButton = page.getByRole("button", { name: "Open in Fixture Editor", exact: true });
    await expect(openButton).toBeVisible();
    await screenshot(page, "open-in-eligible");

    await openButton.click();
    await expect.poll(async () => (await fixtureSnapshot(page)).counters.open).toBe(1);
    const snapshot = await fixtureSnapshot(page);
    expect(snapshot.openedPaths).toEqual([
      { targetId: "fixture-editor", path: "/fixture-workspace/src/example.ts" },
    ]);
    expect(snapshot.counters.reveal).toBe(0);
  });

  test("target menu lists registered targets once and opens via openWithTarget", async ({ page }) => {
    await openFixture(page, `${BASE}?host=desktop&origin=local&case=workspace-file`);
    await page.getByRole("button", { name: "Choose Open in Fixture Editor" }).click();
    const menuItem = page.locator('[data-slot="popover-content"]').getByRole("button", { name: "Fixture Editor" });
    await expect(menuItem).toHaveCount(1);
    await screenshot(page, "open-in-target-menu-open");

    await menuItem.click();
    await expect.poll(async () => (await fixtureSnapshot(page)).counters.open).toBe(1);
  });

  test("remote provenance renders no open-in control and performs zero native calls", async ({ page }) => {
    await openFixture(page, `${BASE}?host=desktop&origin=remote&case=workspace-file`);
    await expect(page.getByRole("button", { name: /^Open in /, exact: false })).toHaveCount(0);
    const snapshot = await fixtureSnapshot(page);
    expect(snapshot.counters).toMatchObject({ discovery: 0, open: 0, reveal: 0, home: 0, inspection: 0 });
    await screenshot(page, "open-in-remote-no-control");
  });

  test("no desktop bridge (web host) renders no open-in control and performs zero native calls", async ({ page }) => {
    await openFixture(page, `${BASE}?host=web&origin=local&case=workspace-file`);
    await expect(page.getByRole("button", { name: /^Open in /, exact: false })).toHaveCount(0);
    const snapshot = await fixtureSnapshot(page);
    expect(snapshot.counters).toMatchObject({ discovery: 0, open: 0, reveal: 0, home: 0, inspection: 0 });
  });
});

test.describe("content search on the file surface", () => {
  test("Find opens the pill on the file surface, and closing restores focus to Find", async ({ page }) => {
    await openFixture(page, `${BASE}?case=workspace-file`);
    const findButton = page.getByRole("button", { name: "Find in file" });
    await findButton.click();

    const overlay = page.locator("[data-content-search-overlay]");
    await expect(overlay).toHaveAttribute("data-content-search-surface", "file");
    const input = page.getByRole("textbox", { name: "Find in file" });
    await expect(input).toBeFocused();
    await screenshot(page, "search-open-file-surface");

    await page.keyboard.press("Escape");
    await expect(overlay).toHaveCount(0);
    await expect(findButton).toBeFocused();
  });

  test("rendered Markdown switches to source once on open, and stays there on navigation", async ({ page }) => {
    await openFixture(page, `${BASE}?case=workspace-file&path=${encodeURIComponent(FIXTURE_MARKDOWN_PATH)}`);
    await expect(page.locator("[data-file-source-view]")).toHaveCount(0);
    await page.getByRole("button", { name: "Find in file" }).click();
    await expect(page.locator("[data-file-source-view]")).toBeVisible();

    const input = page.getByRole("textbox", { name: "Find in file" });
    await input.fill("needle");
    await expect(page.getByText("1 of 2")).toBeVisible();
    await page.getByRole("button", { name: "Next result" }).click();
    // Still source mode: it does not oscillate back to rendered on navigation.
    await expect(page.locator("[data-file-source-view]")).toBeVisible();
  });

  test("query, match count, and next/previous navigation", async ({ page }) => {
    await openFixture(page, `${BASE}?case=workspace-file&path=${encodeURIComponent(FIXTURE_SEARCH_MATCHES_PATH)}`);
    await page.getByRole("button", { name: "Find in file" }).click();
    const input = page.getByRole("textbox", { name: "Find in file" });
    await input.fill("needle");
    await expect(page.getByText("1 of 3")).toBeVisible();
    await screenshot(page, "search-matches");

    await page.getByRole("button", { name: "Next result" }).click();
    await expect(page.getByText("2 of 3")).toBeVisible();
    await page.getByRole("button", { name: "Previous result" }).click();
    await expect(page.getByText("1 of 3")).toBeVisible();
  });

  test("too-large and binary targets hide Find", async ({ page }) => {
    await openFixture(page, `${BASE}?case=workspace-file&path=${encodeURIComponent(FIXTURE_TOO_LARGE_PATH)}`);
    await expect(page.getByRole("button", { name: "Find in file" })).toHaveCount(0);

    await openFixture(page, `${BASE}?case=workspace-file&path=${encodeURIComponent(FIXTURE_BINARY_PATH)}`);
    await expect(page.getByRole("button", { name: "Find in file" })).toHaveCount(0);
  });

  test("activating a tree row while search is open closes it without the old Find control reclaiming focus", async ({ page }) => {
    await openFixture(page, `${BASE}?case=workspace-file`);
    await page.getByRole("button", { name: "Show files" }).click();
    await expect(page.getByRole("treeitem", { name: "README.md" })).toBeVisible();

    const findButton = page.getByRole("button", { name: "Find in file" });
    await findButton.click();
    await expect(page.locator("[data-content-search-overlay]")).toBeVisible();

    await page.getByRole("treeitem", { name: "README.md" }).click();
    await expect(page.locator("[data-content-search-overlay]")).toHaveCount(0);
    // The suppressed close must not hand focus back to the (now stale) old
    // file's Find button.
    const findButtonIsActive = await findButton.evaluate((el) => el === document.activeElement);
    expect(findButtonIsActive).toBe(false);
  });
});

test.describe("geometry and placement", () => {
  test("file search paints at 90px/16px and never overlaps header, tab strip, or content edge", async ({ page }) => {
    await openFixture(page, `${BASE}?case=workspace-file`);
    await page.getByRole("button", { name: "Find in file" }).click();
    const overlay = page.locator("[data-content-search-overlay]");
    await expect(overlay).toHaveCSS("top", "90px");
    await expect(overlay).toHaveCSS("right", "16px");

    const overlayBox = await overlay.boundingBox();
    const toolbarBox = await page.locator("[data-file-viewer-toolbar]").boundingBox();
    expect(overlayBox).not.toBeNull();
    expect(toolbarBox).not.toBeNull();
    // Never covers the header: the pill's top edge sits below the header's bottom edge.
    expect(overlayBox!.y).toBeGreaterThanOrEqual(toolbarBox!.y + toolbarBox!.height - 1);
  });

  test("380px minimum content width holds with the dock open", async ({ page }) => {
    await page.setViewportSize({ width: 1101, height: 720 });
    await openFixture(page, `${BASE}?case=workspace-file&railWidth=280`);
    await page.getByRole("button", { name: "Show files" }).click();
    await expect(page.locator("[data-docked-file-tree]")).toBeVisible();
    await expect
      .poll(async () => page.locator("[data-file-viewer-content]").evaluate((el) => el.clientWidth))
      .toBeGreaterThanOrEqual(380);
    await screenshot(page, "geometry-dock-open-380-floor");
  });

  test("dock closed keeps the full content width and no pill/dock overlap", async ({ page }) => {
    await openFixture(page, `${BASE}?case=workspace-file`);
    await expect(page.locator("[data-docked-file-tree]")).toHaveCount(0);
    await page.getByRole("button", { name: "Find in file" }).click();
    await screenshot(page, "geometry-dock-closed-search-open");
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`renders header, open-in, and search correctly in ${colorScheme}`, async ({ page }) => {
      await openFixture(page, `${BASE}?host=desktop&origin=local&case=workspace-file`, colorScheme);
      await page.getByRole("button", { name: "Find in file" }).click();
      await screenshot(page, `geometry-appearance-${colorScheme}`);
    });
  }
});

interface FixtureSnapshot {
  counters: {
    clipboard: number;
    discovery: number;
    home: number;
    inspection: number;
    nativeMenu: number;
    open: number;
    reveal: number;
  };
  clipboardValues: string[];
  openedPaths: Array<{ targetId: string; path: string }>;
}

async function openFixture(
  page: Page,
  path: string,
  colorScheme: "light" | "dark" = "dark",
): Promise<void> {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") {
      await route.continue();
      return;
    }
    await route.abort("blockedbyclient");
  });
  await page.clock.setFixedTime(new Date("2026-08-19T12:00:00.000Z"));
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme });
  await page.goto(path);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.locator("[data-file-reference-routing-fixture]")).toBeVisible();
  await page.locator('button[data-file-reference-badge="chip"]').click();
  await expect(page.locator("[data-file-viewer-frame]")).toBeVisible();
}

async function openOptionsMenu(page: Page) {
  await page.getByRole("button", { name: "File viewer options" }).click();
  const menu = page.locator('[data-slot="popover-content"]');
  await expect(menu).toBeVisible();
  return menu;
}

async function fixtureSnapshot(page: Page): Promise<FixtureSnapshot> {
  return page.evaluate(() => {
    const fixtureWindow = window as typeof window & {
      __fileReferenceRoutingFixture: { snapshot(): FixtureSnapshot };
    };
    return fixtureWindow.__fileReferenceRoutingFixture.snapshot();
  });
}

async function screenshot(page: Page, name: string): Promise<void> {
  await expect(page).toHaveScreenshot(`${name}.png`);
}
