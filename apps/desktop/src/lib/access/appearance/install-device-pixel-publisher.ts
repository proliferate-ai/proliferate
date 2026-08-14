import { useUserPreferencesStore } from "@proliferate/product-client/internal/stores/preferences/user-preferences-store";

// Native zoom lands asynchronously after the preference changes (store ->
// native setZoom -> webview ratio update), so re-read the ratio on a frame
// and again after short settle delays; publishing is idempotent.
const REPUBLISH_DELAYS_MS = [120, 400];

/**
 * Publishes --proliferate-device-px: the size of one physical device pixel
 * in CSS units (1 / devicePixelRatio, which on the Desktop webview already
 * folds native window zoom into the ratio). desktop.css hairline frames use
 * it to rasterize at exactly one device pixel at every window zoom and
 * display density — WebKit drops sub-device-pixel hairlines to zero on
 * individual edges (PRO-117).
 *
 * Re-publishing is driven by the window-zoom preference (the same signal
 * that drives native zoom) plus resize and the matchMedia resolution idiom
 * for display moves. WKWebView does NOT fire resolution media-query changes
 * when page zoom changes — devicePixelRatio updates silently — so the
 * preference subscription is the load-bearing trigger, verified live.
 *
 * Lives host-side (not in the shared product package) so the Desktop-only
 * lifecycle never ships in the Web login bundle; it runs for the window's
 * lifetime and needs no teardown.
 */
export function installDesktopDevicePixelPublisher(): void {
  const root = document.documentElement;
  let media: MediaQueryList | null = null;
  const publish = () => {
    root.style.setProperty(
      "--proliferate-device-px",
      `${1 / window.devicePixelRatio}px`,
    );
    media?.removeEventListener("change", publish);
    media = window.matchMedia?.(`(resolution: ${window.devicePixelRatio}dppx)`) ?? null;
    media?.addEventListener("change", publish);
  };
  const schedulePublish = () => {
    requestAnimationFrame(publish);
    for (const delay of REPUBLISH_DELAYS_MS) {
      window.setTimeout(publish, delay);
    }
  };
  publish();
  schedulePublish();
  window.addEventListener("resize", schedulePublish);
  useUserPreferencesStore.subscribe((state, previous) => {
    if (state.windowZoomId !== previous.windowZoomId) {
      schedulePublish();
    }
  });
}
