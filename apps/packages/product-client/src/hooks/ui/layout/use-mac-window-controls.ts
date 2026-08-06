import { useProductHost } from "#product/host/ProductHostProvider";

/**
 * Left inset that clears the macOS window buttons in a 46px title row.
 * Only apply it through `useMacWindowControlsInsetClass` — a host without
 * those buttons (Web, Windows, Linux) must not reserve the gap, or the space
 * reads as a broken hole at the top of the surface.
 */
export const MAC_WINDOW_CONTROLS_INSET_CLASS = "pl-[82px]";

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform = nav.userAgentData?.platform ?? navigator.platform;
  return /\bmac/i.test(platform);
}

/**
 * True only when the current host actually paints macOS window buttons over
 * the app's own chrome: a native Desktop bridge (`desktop !== null` — the host
 * capability check, not a global-probe sniff) on a Mac platform.
 */
export function useHasMacWindowControls(): boolean {
  const isDesktop = useProductHost().desktop !== null;
  return isDesktop && isMacPlatform();
}

/** Window-controls inset class, or `""` on hosts without those controls. */
export function useMacWindowControlsInsetClass(): string {
  return useHasMacWindowControls() ? MAC_WINDOW_CONTROLS_INSET_CLASS : "";
}
