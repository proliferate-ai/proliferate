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
  await control.evaluate(
    async (node, options) => {
      const nextFrame = () =>
        new Promise<number>((resolve) => requestAnimationFrame(() => resolve(performance.now())));
      const fullyInsideOverflowClips = (rect: DOMRect) => {
        for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
          const style = window.getComputedStyle(ancestor);
          const clipsX = style.overflowX !== "visible";
          const clipsY = style.overflowY !== "visible";
          if (!clipsX && !clipsY) continue;

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
        return true;
      };

      for (let attempt = 0; attempt < options.attempts; attempt += 1) {
        const first = node.getBoundingClientRect();
        const startedAt = await nextFrame();
        let now = startedAt;
        while (now - startedAt < options.settleMs) {
          now = await nextFrame();
        }
        const second = node.getBoundingClientRect();
        const stableAndInViewport =
          first.width > 0 &&
          first.height > 0 &&
          Math.abs(first.left - second.left) < 0.5 &&
          Math.abs(first.top - second.top) < 0.5 &&
          Math.abs(first.width - second.width) < 0.5 &&
          Math.abs(first.height - second.height) < 0.5 &&
          second.left >= 0 &&
          second.top >= 0 &&
          second.right <= window.innerWidth &&
          second.bottom <= window.innerHeight &&
          fullyInsideOverflowClips(second);
        if (!stableAndInViewport) continue;

        const centerX = second.left + second.width / 2;
        const centerY = second.top + second.height / 2;
        const topAtCenter = document.elementFromPoint(centerX, centerY);
        if (topAtCenter && (topAtCenter === node || node.contains(topAtCenter))) return;
      }

      throw new Error("sidebar control did not settle into an interactable layout");
    },
    { attempts: SIDEBAR_SETTLE_ATTEMPTS, settleMs: SIDEBAR_TRANSITION_SETTLE_MS },
  );
}
