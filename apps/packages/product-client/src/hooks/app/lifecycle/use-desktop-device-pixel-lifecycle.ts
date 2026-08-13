import { useEffect } from "react";

import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";

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
 */
export function useDesktopDevicePixelLifecycle(): void {
  useEffect(() => {
    const root = document.documentElement;
    let media: MediaQueryList | null = null;
    let frame = 0;
    let timers: number[] = [];
    let disposed = false;
    const publish = () => {
      if (disposed) {
        return;
      }
      root.style.setProperty(
        "--proliferate-device-px",
        `${1 / window.devicePixelRatio}px`,
      );
      media?.removeEventListener("change", publish);
      media = window.matchMedia?.(`(resolution: ${window.devicePixelRatio}dppx)`) ?? null;
      media?.addEventListener("change", publish);
    };
    const schedulePublish = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(publish);
      timers.forEach((timer) => window.clearTimeout(timer));
      timers = REPUBLISH_DELAYS_MS.map((delay) => window.setTimeout(publish, delay));
    };
    publish();
    schedulePublish();
    window.addEventListener("resize", schedulePublish);
    const unsubscribe = useUserPreferencesStore.subscribe((state, previous) => {
      if (state.windowZoomId !== previous.windowZoomId) {
        schedulePublish();
      }
    });
    return () => {
      disposed = true;
      unsubscribe();
      window.removeEventListener("resize", schedulePublish);
      cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
      media?.removeEventListener("change", publish);
      root.style.removeProperty("--proliferate-device-px");
    };
  }, []);
}
