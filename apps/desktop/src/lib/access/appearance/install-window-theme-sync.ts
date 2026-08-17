import { useUserPreferencesStore } from "@proliferate/product-client/internal/stores/preferences/user-preferences-store";

import { setWindowTheme } from "@/lib/access/tauri/window";

/**
 * Keeps AppKit's material appearance aligned with the product color mode.
 * This stays host-side so the Desktop-only observer never ships in Web.
 */
export function installDesktopWindowThemeSync(): () => void {
  const sync = () => {
    const { _hydrated, colorMode } = useUserPreferencesStore.getState();
    if (!_hydrated) {
      return;
    }

    void setWindowTheme(colorMode === "system" ? null : colorMode).catch(() => {
      // Native appearance is non-critical; document theming still applies.
    });
  };

  sync();
  return useUserPreferencesStore.subscribe((state, previous) => {
    if (
      state._hydrated
      && (!previous._hydrated || state.colorMode !== previous.colorMode)
    ) {
      sync();
    }
  });
}
