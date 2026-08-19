import { expect, test, type Page } from "@playwright/test";
import {
  FIXTURE_BROKEN_SYMLINK_PATH,
  FIXTURE_DEEP_FILE_PATH,
  FIXTURE_EMPTY_DIR_PATH,
  FIXTURE_RETRY_DIR_PATH,
  FIXTURE_TERMINAL_ERROR_DIR_PATH,
} from "../src/file-tree-fixture";

/**
 * Docked file-tree qualification suite (spec "02A - Docked File Tree",
 * "Tests and qualification" items 4 and 10). Extends the same
 * `/playground/files` fixture host as `file-reference-routing.spec.ts`: one
 * production `WorkspaceShellRightRail` -> `RightPanel` -> `FileEditorView`
 * -> `FileViewerFrame` chain, with `file-tree-fixture.ts`'s deterministic
 * directory/search/stat transport and scripted/unscripted accounting.
 *
 * Chromium-only (`playwright.config.ts`'s sole configured project); no
 * WebKit project is added here.
 *
 * NOTE for reviewers: this suite exercises the docked tree end-to-end
 * (`[data-docked-file-tree]`, the `Files` toggle, the resize separator),
 * which is Workstream B's `FileEditorView`/`DockedFileTree` integration. It
 * was written against the frozen contract ahead of that integration landing,
 * per the spec's implementation-order note ("After B integrates, C completes
 * the single production-chain fixture, screenshots, docs, and checker
 * cleanup"); B's `FileEditorView` now adopts the
 * `FileViewerFrame`/`ensureRightPanelWidth` seam this workstream defines, and
 * this suite passes.
 */

const FIXTURE_PATH = "/playground/files?case=workspace-file";

test.describe("docked file tree geometry", () => {
  test("closed dock keeps the default 420px rail", async ({ page }) => {
    await openFixture(page, FIXTURE_PATH);
    await expect(page.locator("[data-right-panel-rail]")).toBeVisible();
    await expect(page.locator("[data-docked-file-tree]")).toHaveCount(0);
    await screenshot(page, "dock-closed-default-420");
  });

  test("explicit open widens the rail to the desired-width target (781/780)", async ({ page }) => {
    await openFixture(page, FIXTURE_PATH);
    await toggleFilesOpen(page);

    await expect.poll(async () => clientWidth(page, "[data-right-panel-rail]")).toBe(781);
    await expect.poll(async () => clientWidth(page, "[data-file-viewer-body]")).toBe(780);
    await expect(page.locator("[data-docked-file-tree]")).toBeVisible();
    await screenshot(page, "dock-open-781-780");
  });

  test("shell-clamped rail still opens at the 661/660 minimum", async ({ page }) => {
    // The rail is `min(--workspace-right-width, 100% - 440px)`, so the named
    // 661/660 clamped case is only reachable at a 1101px shell.
    await page.setViewportSize({ width: 1101, height: 720 });
    await openFixture(page, `${FIXTURE_PATH}&railWidth=280`);
    await toggleFilesOpen(page);

    await expect.poll(async () => clientWidth(page, "[data-right-panel-rail]")).toBeGreaterThanOrEqual(661);
    await expect.poll(async () => clientWidth(page, "[data-file-viewer-body]")).toBeGreaterThanOrEqual(660);
    await screenshot(page, "dock-open-661-660-clamped");
  });

  test("a wide custom desired width is respected", async ({ page }) => {
    await openFixture(page, `${FIXTURE_PATH}&railWidth=900`);
    await toggleFilesOpen(page);
    await expect(page.locator("[data-docked-file-tree]")).toBeVisible();
    await screenshot(page, "dock-open-wide-custom-width");
  });

  test("auto-collapses below the 660px body threshold without losing requested visibility", async ({ page }) => {
    await openFixture(page, FIXTURE_PATH);
    await toggleFilesOpen(page);
    await page.setViewportSize({ width: 700, height: 720 });

    await expect(page.locator("[data-docked-file-tree]")).toHaveCount(0);
    const toggle = page.getByRole("button", { name: "Hide files" });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle).toHaveAttribute("title", "Widen the window to show files");
    await screenshot(page, "dock-auto-collapsed-narrow-shell");
  });
});

test.describe("docked file tree content", () => {
  test("renders a long nested path and the selected deep file", async ({ page }) => {
    await openFixture(page, FIXTURE_PATH);
    await toggleFilesOpen(page);
    await revealPath(page, FIXTURE_DEEP_FILE_PATH);
    await expect(page.getByRole("treeitem", { name: "path.ts" })).toBeVisible();
    await screenshot(page, "dock-long-path-selected-deep-file");
  });

  test("nested directory loading, retryable failure, and retry recovery", async ({ page }) => {
    await openFixture(page, FIXTURE_PATH);
    await toggleFilesOpen(page);

    const retryRow = page.getByRole("treeitem", { name: "Retry folder" });
    await expandRow(page, FIXTURE_RETRY_DIR_PATH);
    await expect(retryRow).toBeVisible();
    await screenshot(page, "dock-nested-retry-failure");

    await retryRow.click();
    await expect(page.getByRole("treeitem", { name: "settled.ts" })).toBeVisible();
    await screenshot(page, "dock-nested-retry-recovered");
  });

  test("empty directory renders its empty state", async ({ page }) => {
    await openFixture(page, FIXTURE_PATH);
    await toggleFilesOpen(page);
    await expandRow(page, FIXTURE_EMPTY_DIR_PATH);
    await screenshot(page, "dock-empty-directory");
  });

  test("search renders the 60-result search tree", async ({ page }) => {
    await openFixture(page, FIXTURE_PATH);
    await toggleFilesOpen(page);
    await page.getByPlaceholder("Filter files…").fill("ts");
    await expect(page.getByRole("tree")).toBeVisible();
    await screenshot(page, "dock-search-results");
  });

  test("terminal directory failure renders a bounded non-action status", async ({ page }) => {
    await openFixture(page, FIXTURE_PATH);
    await toggleFilesOpen(page);
    await expandRow(page, FIXTURE_TERMINAL_ERROR_DIR_PATH);
    await screenshot(page, "dock-terminal-error");
  });

  test("an unexpected-kind symlink row is disabled and unavailable", async ({ page }) => {
    await openFixture(page, FIXTURE_PATH);
    await toggleFilesOpen(page);
    const row = page.getByRole("treeitem", { name: "broken-link" });
    // Symlink stat is performed on activation/reveal, never eagerly, so the
    // unavailable state is proven by activating the row once.
    await row.click();
    await expect(row).toHaveAttribute("aria-disabled", "true");
    await screenshot(page, "dock-unavailable-symlink");
  });
});

test.describe("docked file tree appearance", () => {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`renders correctly in ${colorScheme}`, async ({ page }) => {
      await openFixture(page, FIXTURE_PATH, colorScheme);
      await toggleFilesOpen(page);
      await screenshot(page, `dock-open-${colorScheme}`);
    });
  }
});

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
  // The dock lives inside `FileViewerFrame`, which only mounts once a file
  // target is open. Use the same production entry point
  // `file-reference-routing.spec.ts` uses: activate the reference badge.
  await page.locator('button[data-file-reference-badge="chip"]').click();
  await expect(page.locator("[data-file-viewer-frame]")).toBeVisible();
}

async function toggleFilesOpen(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Show files" }).click();
  await expect(page.locator("[data-docked-file-tree]")).toBeVisible();
  // Settle the root listing so no screenshot races the "Loading files…" status.
  await expect(page.getByRole("treeitem", { name: "README.md" })).toBeVisible();
}

async function expandRow(page: Page, path: string): Promise<void> {
  const name = path.split("/").pop() ?? path;
  await page.getByRole("treeitem", { name }).click();
}

async function revealPath(page: Page, path: string): Promise<void> {
  for (const segment of path.split("/").slice(0, -1)) {
    const row = page.getByRole("treeitem", { name: segment });
    // The selected file's ancestors are already expanded by the controller;
    // clicking them again would collapse them.
    if ((await row.getAttribute("aria-expanded")) === "true") {
      continue;
    }
    await row.click();
  }
}

async function clientWidth(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((element) => element.clientWidth);
}

async function screenshot(page: Page, name: string): Promise<void> {
  await expect(page).toHaveScreenshot(`${name}.png`);
}
