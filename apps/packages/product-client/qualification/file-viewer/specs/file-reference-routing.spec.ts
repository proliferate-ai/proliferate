import { expect, test, type Page } from "@playwright/test";

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
  nativeMenuItems: Array<{
    kind: "action" | "separator" | "submenu";
    id?: string;
    label?: string;
    enabled?: boolean;
  }>;
  openedPaths: Array<{ targetId: string; path: string }>;
  revealedPaths: string[];
}

const WORKSPACE_ROUTES = [
  {
    name: "Desktop with local provenance",
    path: "/playground/files?host=desktop&origin=local&case=workspace-file",
    localDesktop: true,
  },
  {
    name: "Desktop with remote provenance",
    path: "/playground/files?host=desktop&origin=remote&case=workspace-file",
    localDesktop: false,
  },
  {
    name: "Web with local provenance",
    path: "/playground/files?host=web&origin=local&case=workspace-file",
    localDesktop: false,
  },
  {
    name: "Web with remote provenance",
    path: "/playground/files?host=web&origin=remote&case=workspace-file",
    localDesktop: false,
  },
] as const;

for (const route of WORKSPACE_ROUTES) {
  test(`${route.name} opens the settled workspace file in the viewer`, async ({ page }) => {
    const externalRequests = await openFixture(page, route.path);
    const badge = page.locator('button[data-file-reference-badge="chip"]');
    await expect(badge).toBeVisible();

    if (route.localDesktop) {
      await expect.poll(async () => (await fixtureSnapshot(page)).counters.discovery).toBe(1);
    }

    await badge.click();
    await expect(page.locator("[data-file-viewer-frame]")).toBeVisible();
    await expect(page.locator('[data-file-reference-viewer="active"]')).toBeVisible();

    if (route.localDesktop) {
      await badge.click({ button: "right" });
      const openExternal = page.getByRole("menuitem", { name: "Open in Fixture Editor" });
      await expect(openExternal).toBeVisible();
      await openExternal.click();
      await expect.poll(async () => (await fixtureSnapshot(page)).counters.open).toBe(1);

      const snapshot = await fixtureSnapshot(page);
      expect(snapshot.counters.home).toBe(0);
      expect(snapshot.counters.inspection).toBe(0);
      expect(snapshot.counters.reveal).toBe(0);
      expect(snapshot.openedPaths).toEqual([
        { targetId: "fixture-editor", path: "/fixture-workspace/src/example.ts" },
      ]);
    } else {
      expectNativePathCalls(await fixtureSnapshot(page)).toEqual({
        discovery: 0,
        home: 0,
        inspection: 0,
        open: 0,
        reveal: 0,
      });
    }

    expect(externalRequests).toEqual([]);
  });
}

test("local Desktop opens an authority-proven Desktop file natively", async ({ page }) => {
  const externalRequests = await openFixture(
    page,
    "/playground/files?host=desktop&origin=local&case=desktop-file",
  );
  const badge = page.locator('button[data-file-reference-badge="chip"]');
  await expect(badge).toBeVisible();
  await expect.poll(async () => (await fixtureSnapshot(page)).counters.inspection).toBe(1);
  await expect.poll(async () => (await fixtureSnapshot(page)).counters.discovery).toBe(1);

  await badge.click();
  await expect.poll(async () => (await fixtureSnapshot(page)).counters.open).toBe(1);
  await expect(page.locator("[data-file-viewer-frame]")).toHaveCount(0);

  const snapshot = await fixtureSnapshot(page);
  expect(snapshot.counters.home).toBe(0);
  expect(snapshot.counters.reveal).toBe(0);
  expect(snapshot.openedPaths).toEqual([
    { targetId: "fixture-editor", path: "/outside/reference.txt" },
  ]);
  expect(externalRequests).toEqual([]);
});

test("remote Desktop unavailable reference exposes exactly Copy path", async ({ page }) => {
  const externalRequests = await openFixture(
    page,
    "/playground/files?host=desktop&origin=remote&case=unavailable",
  );
  const badge = page.locator('[data-file-reference-badge="chip"]');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute("data-file-reference-unavailable", "true");

  await badge.click({ button: "right" });
  const menu = page.locator('[data-slot="popover-content"]');
  const menuItems = menu.getByRole("menuitem");
  await expect(menuItems).toHaveCount(1);
  await expect(menuItems.first()).toBeEnabled();
  await expect(menuItems.first()).toHaveText("Copy path");
  await expect(menu.locator(":scope > div > .h-px")).toHaveCount(0);

  await expect.poll(async () => (await fixtureSnapshot(page)).counters.nativeMenu).toBe(1);
  let snapshot = await fixtureSnapshot(page);
  expect(snapshot.nativeMenuItems).toEqual([
    {
      kind: "action",
      id: "copy-path",
      label: "Copy path",
      enabled: true,
    },
  ]);
  expectNativePathCalls(snapshot).toEqual({
    discovery: 0,
    home: 0,
    inspection: 0,
    open: 0,
    reveal: 0,
  });

  await menuItems.first().click();
  snapshot = await fixtureSnapshot(page);
  expect(snapshot.counters.clipboard).toBe(1);
  expect(snapshot.clipboardValues).toEqual(["/outside/reference.txt"]);
  expect(externalRequests).toEqual([]);
});

for (const inertCase of ["empty", "whitespace"] as const) {
  test(`${inertCase} reference exposes no DOM or native menu`, async ({ page }) => {
    const externalRequests = await openFixture(
      page,
      `/playground/files?host=desktop&origin=local&case=${inertCase}`,
    );
    const badge = page.locator('[data-file-reference-badge="chip"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute("data-file-reference-unavailable", "true");
    await badge.click({ button: "right" });

    await expect(page.locator('[data-slot="popover-content"]')).toHaveCount(0);
    const snapshot = await fixtureSnapshot(page);
    expect(snapshot.counters).toEqual({
      clipboard: 0,
      discovery: 0,
      home: 0,
      inspection: 0,
      nativeMenu: 0,
      open: 0,
      reveal: 0,
    });
    expect(snapshot.clipboardValues).toEqual([]);
    expect(snapshot.nativeMenuItems).toEqual([]);
    expect(externalRequests).toEqual([]);
  });
}

async function openFixture(page: Page, path: string): Promise<string[]> {
  const externalRequests: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") {
      await route.continue();
      return;
    }
    externalRequests.push(url.href);
    await route.abort("blockedbyclient");
  });
  await page.clock.setFixedTime(new Date("2026-08-19T12:00:00.000Z"));
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.goto(path);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.locator("[data-file-reference-routing-fixture]")).toBeVisible();
  return externalRequests;
}

async function fixtureSnapshot(page: Page): Promise<FixtureSnapshot> {
  return page.evaluate(() => {
    const fixtureWindow = window as typeof window & {
      __fileReferenceRoutingFixture: { snapshot(): FixtureSnapshot };
    };
    return fixtureWindow.__fileReferenceRoutingFixture.snapshot();
  });
}

function expectNativePathCalls(snapshot: FixtureSnapshot) {
  return expect({
    discovery: snapshot.counters.discovery,
    home: snapshot.counters.home,
    inspection: snapshot.counters.inspection,
    open: snapshot.counters.open,
    reveal: snapshot.counters.reveal,
  });
}
