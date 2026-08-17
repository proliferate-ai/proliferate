import { useEffect } from "react";

import type { DesktopNativeUiBridge } from "@proliferate/product-client/host/desktop-bridge";

import { getResolvedMode, onThemeChange } from "#product/config/theme";

export function useDesktopWindowThemeLifecycle(
  setWindowTheme: DesktopNativeUiBridge["setWindowTheme"],
): void {
  useEffect(() => {
    const applyResolvedTheme = () => {
      void setWindowTheme(getResolvedMode()).catch(() => {
        // Native appearance is non-critical; document theme still applies.
      });
    };

    applyResolvedTheme();
    return onThemeChange(applyResolvedTheme);
  }, [setWindowTheme]);
}
