import {
  getResolvedMode,
  onThemeChange,
} from "@proliferate/product-client/internal/config/theme";

import { setWindowTheme } from "@/lib/access/tauri/window";

/**
 * Keeps AppKit's material appearance aligned with the product color mode.
 * This stays host-side so the Desktop-only observer never ships in Web.
 */
export function installDesktopWindowThemeSync(): void {
  const sync = () => {
    void setWindowTheme(getResolvedMode()).catch(() => {
      // Native appearance is non-critical; document theming still applies.
    });
  };

  sync();
  onThemeChange(sync);
}
