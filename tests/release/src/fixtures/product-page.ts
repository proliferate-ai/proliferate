import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Browser, BrowserContext, Page } from "playwright";

import type { ReadyLocalWorld } from "../worlds/local-workspace/world.js";
import type { AuthenticatedActor, StoredAuthSession } from "./authenticated-actor.js";

/** Records browser console output for env-gated failure diagnostics. */
function captureConsole(page: Page, sink: string[]): void {
  if (!process.env.LOCAL_WORLD_SMOKE_DEBUG_DIR) {
    return;
  }
  page.on("console", (message) => sink.push(`[${message.type()}] ${message.text()}`));
  page.on("pageerror", (error) => sink.push(`[pageerror] ${error.message}`));
}

/**
 * Env-gated (`LOCAL_WORLD_SMOKE_DEBUG_DIR`) dump of the rendered DOM, a
 * screenshot, and captured console output on a UI failure. A no-op unless the
 * env var is set, so it never touches the green path or CI.
 */
async function dumpFailureArtifacts(page: Page | undefined, consoleLog: string[], label: string): Promise<void> {
  const dir = process.env.LOCAL_WORLD_SMOKE_DEBUG_DIR;
  if (!dir || !page) {
    return;
  }
  try {
    mkdirSync(dir, { recursive: true });
    const stamp = `${label}-${Date.now()}`;
    writeFileSync(path.join(dir, `${stamp}.html`), await page.content().catch(() => "<no content>"));
    writeFileSync(path.join(dir, `${stamp}.console.txt`), consoleLog.join("\n"));
    await page.screenshot({ path: path.join(dir, `${stamp}.png`), fullPage: true }).catch(() => undefined);
  } catch {
    // Diagnostics are best-effort; never mask the real failure.
  }
}

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
 * Readiness is asserted on a stable authenticated-home hook rather than a
 * `data-testid`: this app ships almost no production `data-testid`s, but the
 * home composer carries `data-home-composer-editor="true"` and the app shell
 * carries `data-workspace-shell="true"` — both present only once the app has
 * booted authenticated (verified against a live render 2026-07-14: the earlier
 * "Choose repository"/"Work locally" copy is not the current home surface).
 */

export interface ProductPage {
  context: BrowserContext;
  page: Page;
  /** Closes the page + context; registered with the world cleanup stack. */
  close(): Promise<void>;
}

export const BROWSER_AUTH_SESSION_KEY = "proliferate.auth.session";

/**
 * CSS selector for a stable authenticated-home hook (see module doc): the home
 * composer editor, or the app shell as a fallback. Present only after the app
 * boots authenticated.
 */
export const AUTHENTICATED_READINESS_SELECTOR =
  '[data-home-composer-editor="true"], [data-workspace-shell="true"]';

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
    await page.locator(AUTHENTICATED_READINESS_SELECTOR).first().waitFor({ state: "visible", timeout: timeoutMs });
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
  const consoleLog: string[] = [];
  try {
    await driver.installSession(context, actor.session);
    page = await driver.newPage(context);
    captureConsole(page, consoleLog);
    await driver.goto(page, world.renderer.baseUrl);
    await driver.waitForAuthenticatedReadiness(page, options.readinessTimeoutMs ?? 30_000);
  } catch (error) {
    // Optional env-gated failure capture: dump the actual rendered DOM,
    // a screenshot, and captured console output so a boot/selector failure can
    // be diagnosed without a live browser. Never on the green path.
    await dumpFailureArtifacts(page, consoleLog, "product-page-readiness");
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
