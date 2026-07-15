import { useEffect } from "react";
import {
  applyAppearancePreference,
  initializeTheme,
} from "@/config/theme";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

function applyStoredAppearancePreference(): void {
  const {
    colorMode,
    uiFontSizeId,
    readableCodeFontSizeId,
    windowZoomId,
  } = useUserPreferencesStore.getState();
  applyAppearancePreference({
    colorMode,
    uiFontSizeId,
    readableCodeFontSizeId,
    windowZoomId,
  });
}

// Owns applying user appearance preferences to document-level theme tokens.
export function useAppearancePreferenceLifecycle(): void {
  useEffect(() => {
    initializeTheme();
    applyStoredAppearancePreference();

    const unsubscribeAppearance = useUserPreferencesStore.subscribe((state, prev) => {
      if (
        state.colorMode !== prev.colorMode
        || state.uiFontSizeId !== prev.uiFontSizeId
        || state.readableCodeFontSizeId !== prev.readableCodeFontSizeId
        || state.windowZoomId !== prev.windowZoomId
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
