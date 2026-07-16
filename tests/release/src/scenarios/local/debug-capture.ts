import type { ProductPage } from "../../fixtures/product-page.js";
import { scrubSecretText } from "../../fixtures/redact-diagnostics.js";

/**
 * Env-gated (`LOCAL_WORLD_SMOKE_DEBUG_DIR`) capture of the live rendered DOM, a
 * full-page screenshot, and (when the page's diagnostic sinks are populated) the
 * browser console + network logs at the point a world-backed local driver's
 * browser flow fails. This is the SAME seam the `LOCAL-WORLD-SMOKE-1` reference
 * uses (`captureUiFailure`), factored out so every functional local driver
 * (LOCAL-1..7) participates identically: a selector/flow break can then be
 * root-caused from the captured DOM without a live browser.
 *
 * No-op unless `LOCAL_WORLD_SMOKE_DEBUG_DIR` is set (so it never runs in CI, the
 * green path, or offline unit tests), and fully best-effort — every failure mode
 * is swallowed so diagnostics never mask the real error. All written text is run
 * through `scrubSecretText` so no captured artifact can leak a secret.
 */
export async function captureLocalDriverFailure(
  page: ProductPage | undefined,
  label: string,
): Promise<void> {
  const dir = process.env.LOCAL_WORLD_SMOKE_DEBUG_DIR;
  if (!dir || !page) {
    return;
  }
  try {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const nodePath = await import("node:path");
    mkdirSync(dir, { recursive: true });
    const stamp = `${sanitizeLabel(label)}-${Date.now()}`;
    const html = await page.page.content().catch(() => "<no content>");
    writeFileSync(nodePath.join(dir, `${stamp}.html`), scrubSecretText(html));
    await page.page
      .screenshot({ path: nodePath.join(dir, `${stamp}.png`), fullPage: true })
      .catch(() => undefined);
    if (page.debug) {
      writeFileSync(nodePath.join(dir, `${stamp}.console.txt`), scrubSecretText(page.debug.console.join("\n")));
      writeFileSync(nodePath.join(dir, `${stamp}.network.txt`), scrubSecretText(page.debug.network.join("\n")));
    }
  } catch {
    // Diagnostics are best-effort; never let a capture failure mask the error.
  }
}

/** Keeps the capture filename filesystem-safe (scenario/cell ids carry `/`). */
function sanitizeLabel(label: string): string {
  const slug = label.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "local-driver-failure";
}
