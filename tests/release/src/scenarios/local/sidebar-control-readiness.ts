import type { Locator, Page } from "playwright";

const SIDEBAR_TRANSITION_SETTLE_MS = 200;
const SIDEBAR_SETTLE_ATTEMPTS = 50;

/**
 * Expands the animated workspace sidebar when necessary, then proves the
 * requested control is genuinely interactable before its caller clicks it.
 *
 * Playwright considers a control visible even while an overflow-hidden parent
 * still clips it. The sidebar's width transition can therefore leave a role
 * locator attached and visible while an overflow ancestor clips it, its center
 * is outside the viewport, or an overlay receives the click. Readiness requires
 * stable geometry across a sample wider than the transition, full containment
 * by every overflow-clipping ancestor, and a successful center-point hit test.
 */
export async function waitForSidebarControlReady(
  page: Page,
  control: Locator,
  timeoutMs = 30_000,
): Promise<void> {
  const showSidebar = page.getByRole("button", { name: "Show sidebar" }).first();
  const hideSidebar = page.getByRole("button", { name: "Hide sidebar" }).first();

  await showSidebar.or(hideSidebar).first().waitFor({ state: "visible", timeout: timeoutMs });
  if (await showSidebar.isVisible().catch(() => false)) {
    await showSidebar.click({ timeout: timeoutMs });
    await hideSidebar.waitFor({ state: "visible", timeout: timeoutMs });
  }

  await control.waitFor({ state: "visible", timeout: timeoutMs });
  for (let attempt = 0; attempt < SIDEBAR_SETTLE_ATTEMPTS; attempt += 1) {
    const first = await control.boundingBox();
    await page.waitForTimeout(SIDEBAR_TRANSITION_SETTLE_MS);
    const second = await control.boundingBox();
    const stable =
      first !== null &&
      second !== null &&
      first.width > 0 &&
      first.height > 0 &&
      Math.abs(first.x - second.x) < 0.5 &&
      Math.abs(first.y - second.y) < 0.5 &&
      Math.abs(first.width - second.width) < 0.5 &&
      Math.abs(first.height - second.height) < 0.5;
    if (!stable) {
      continue;
    }

    // Keep the page-isolated callback deliberately flat. Nested helper
    // functions are rewritten by the release bundle with an esbuild `__name`
    // reference, which does not exist in Playwright's browser evaluation
    // realm. The controller owns timing/stability; this callback only performs
    // the one synchronous DOM proof that cannot be expressed through Locator.
    const interactable = await control.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      if (
        rect.left < 0 ||
        rect.top < 0 ||
        rect.right > window.innerWidth ||
        rect.bottom > window.innerHeight
      ) {
        return false;
      }
      let ancestor = node.parentElement;
      while (ancestor) {
        const style = window.getComputedStyle(ancestor);
        const clipsX = style.overflowX !== "visible";
        const clipsY = style.overflowY !== "visible";
        if (clipsX || clipsY) {
          const ancestorRect = ancestor.getBoundingClientRect();
          const clipLeft = ancestorRect.left + ancestor.clientLeft;
          const clipTop = ancestorRect.top + ancestor.clientTop;
          const clipRight = clipLeft + ancestor.clientWidth;
          const clipBottom = clipTop + ancestor.clientHeight;
          if (
            (clipsX && (rect.left < clipLeft || rect.right > clipRight)) ||
            (clipsY && (rect.top < clipTop || rect.bottom > clipBottom))
          ) {
            return false;
          }
        }
        ancestor = ancestor.parentElement;
      }
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const topAtCenter = document.elementFromPoint(centerX, centerY);
      return topAtCenter !== null && (topAtCenter === node || node.contains(topAtCenter));
    });
    if (interactable) {
      return;
    }
  }

  throw new Error("sidebar control did not settle into an interactable layout");
}
