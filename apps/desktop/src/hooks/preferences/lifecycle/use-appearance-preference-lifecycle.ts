import { useEffect } from "react";
import {
  applyAppearancePreference,
  initializeTheme,
} from "@/config/theme";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

function applyStoredAppearancePreference(): void {
  const {
    themePreset,
    colorMode,
    uiFontSizeId,
    readableCodeFontSizeId,
  } = useUserPreferencesStore.getState();
  applyAppearancePreference({
    themePreset,
    colorMode,
    uiFontSizeId,
    readableCodeFontSizeId,
  });
}

// Owns applying user appearance preferences to document-level theme tokens.
export function useAppearancePreferenceLifecycle(): void {
  useEffect(() => {
    initializeTheme();
    applyStoredAppearancePreference();

    const unsubscribeAppearance = useUserPreferencesStore.subscribe((state, prev) => {
      if (
        state.themePreset !== prev.themePreset
        || state.colorMode !== prev.colorMode
        || state.uiFontSizeId !== prev.uiFontSizeId
        || state.readableCodeFontSizeId !== prev.readableCodeFontSizeId
      ) {
        applyStoredAppearancePreference();
      }
    });

    const systemModeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemModeChange = () => {
      if (useUserPreferencesStore.getState().colorMode === "system") {
        applyStoredAppearancePreference();
      }
    };
    systemModeQuery.addEventListener("change", handleSystemModeChange);

    return () => {
      unsubscribeAppearance();
      systemModeQuery.removeEventListener("change", handleSystemModeChange);
    };
  }, []);
}
