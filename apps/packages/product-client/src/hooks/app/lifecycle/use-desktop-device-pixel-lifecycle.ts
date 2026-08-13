import { useEffect } from "react";

/**
 * Publishes --proliferate-device-px: the size of one physical device pixel
 * in CSS units (1 / devicePixelRatio, which on the Desktop webview already
 * folds native window zoom into the ratio). desktop.css hairline frames use
 * it to rasterize at exactly one device pixel at every window zoom and
 * display density — WebKit drops sub-device-pixel hairlines to zero on
 * individual edges (PRO-117). Re-published whenever the effective ratio
 * changes (window zoom, or the window moving between displays), tracked
 * with the standard matchMedia resolution-change idiom.
 */
export function useDesktopDevicePixelLifecycle(): void {
  useEffect(() => {
    const root = document.documentElement;
    let media: MediaQueryList | null = null;
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
    publish();
    return () => {
      disposed = true;
      media?.removeEventListener("change", publish);
      root.style.removeProperty("--proliferate-device-px");
    };
  }, []);
}
