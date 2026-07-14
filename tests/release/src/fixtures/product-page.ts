import type { Browser, BrowserContext, Page } from "playwright";

import type { ReadyLocalWorld } from "../worlds/local-workspace/world.js";
import type { AuthenticatedActor, StoredAuthSession } from "./authenticated-actor.js";

/**
 * `productPage(actor)` (spec "Fixtures"). Prerequisite state only:
 *
 *   - creates a fresh Playwright `BrowserContext` for the actor (isolated
 *     storage) against the world's shared `Browser`;
 *   - installs the real product session into `proliferate.auth.session` before
 *     app boot;
 *   - opens the exact Desktop renderer against this world's Server and
 *     AnyHarness (the renderer was built with those URLs);
 *   - waits for authenticated product readiness; and
 *   - closes its page/context during teardown.
 *
 * One `Browser` is shared by the world; every actor/scenario gets isolated
 * browser storage.
 *
 * Readiness is asserted with resilient, text/role-based selectors rather than
 * `data-testid` hooks: this app ships almost no production `data-testid`s
 * (verified against `apps/desktop/src` 2026-07-14 — the few that exist are
 * test-only mock fixtures), so the stable public surface is visible copy —
 * the home screen's repository-picker prompt ("Choose repository") or its
 * "Work locally" runtime option
 * (`apps/desktop/src/lib/domain/home/home-target-picker.ts`), either of which
 * only renders once the app has booted authenticated.
 */

export interface ProductPage {
  context: BrowserContext;
  page: Page;
  /** Closes the page + context; registered with the world cleanup stack. */
  close(): Promise<void>;
}

export const BROWSER_AUTH_SESSION_KEY = "proliferate.auth.session";

/** Text visible only on the authenticated home screen (see module doc). */
export const AUTHENTICATED_READINESS_PATTERN = /Choose repository|Work locally/i;

export interface ProductPageOptions {
  /** Bounded wait for authenticated readiness after navigation (default 30s). */
  readinessTimeoutMs?: number;
}

/**
 * The Playwright surface this fixture actually uses, factored out so unit
 * tests can fake a browser/context/page without a real Chromium process.
 */
export interface ProductPageDriver {
  newContext(browser: Browser): Promise<BrowserContext>;
  installSession(context: BrowserContext, session: StoredAuthSession): Promise<void>;
  newPage(context: BrowserContext): Promise<Page>;
  goto(page: Page, url: string): Promise<void>;
  waitForAuthenticatedReadiness(page: Page, timeoutMs: number): Promise<void>;
  closePage(page: Page): Promise<void>;
  closeContext(context: BrowserContext): Promise<void>;
}

export const defaultProductPageDriver: ProductPageDriver = {
  async newContext(browser) {
    return browser.newContext();
  },
  async installSession(context, session) {
    // Installed via addInitScript so localStorage is populated BEFORE the
    // renderer's first script runs on any page created from this context —
    // the real desktop client reads proliferate.auth.session at boot
    // (apps/desktop/src/lib/access/tauri/auth.ts's browser fallback path).
    await context.addInitScript(
      ({ key, value }) => {
        window.localStorage.setItem(key, value);
      },
      { key: BROWSER_AUTH_SESSION_KEY, value: JSON.stringify(session) },
    );
  },
  async newPage(context) {
    return context.newPage();
  },
  async goto(page, url) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  },
  async waitForAuthenticatedReadiness(page, timeoutMs) {
    await page.getByText(AUTHENTICATED_READINESS_PATTERN).first().waitFor({ state: "visible", timeout: timeoutMs });
  },
  async closePage(page) {
    await page.close();
  },
  async closeContext(context) {
    await context.close();
  },
};

export async function productPage(
  world: ReadyLocalWorld,
  actor: AuthenticatedActor,
  options: ProductPageOptions = {},
  driver: ProductPageDriver = defaultProductPageDriver,
): Promise<ProductPage> {
  const context = await driver.newContext(world.renderer.browser);
  let page: Page | undefined;
  try {
    await driver.installSession(context, actor.session);
    page = await driver.newPage(context);
    await driver.goto(page, world.renderer.baseUrl);
    await driver.waitForAuthenticatedReadiness(page, options.readinessTimeoutMs ?? 30_000);
  } catch (error) {
    // Never leak a half-opened context/page on a failed boot; the world
    // cleanup stack still owns the shared Browser itself.
    if (page) {
      await driver.closePage(page).catch(() => undefined);
    }
    await driver.closeContext(context).catch(() => undefined);
    throw error;
  }

  const openedPage = page;
  return {
    context,
    page: openedPage,
    close: async () => {
      await driver.closePage(openedPage).catch(() => undefined);
      await driver.closeContext(context).catch(() => undefined);
    },
  };
}
