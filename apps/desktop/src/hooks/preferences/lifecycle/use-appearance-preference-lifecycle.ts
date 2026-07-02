import { useEffect } from "react";
import {
  applyAppearancePreference,
  initializeTheme,
} from "@/config/theme";
import { setWebviewZoom } from "@/lib/access/tauri/window";
import { resolveWindowZoomScale } from "@/lib/domain/preferences/appearance";
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

function applyStoredWindowZoomPreference(): void {
  const { windowZoomId } = useUserPreferencesStore.getState();
  const { factor } = resolveWindowZoomScale(windowZoomId);
  void setWebviewZoom(factor).catch(() => {
    // Non-critical appearance preference; the CSS tokens still update.
  });
}

// Owns applying user appearance preferences to document-level theme tokens.
export function useAppearancePreferenceLifecycle(): void {
  useEffect(() => {
    initializeTheme();
    applyStoredAppearancePreference();
    applyStoredWindowZoomPreference();

    const unsubscribeAppearance = useUserPreferencesStore.subscribe((state, prev) => {
      if (
        state.colorMode !== prev.colorMode
        || state.uiFontSizeId !== prev.uiFontSizeId
        || state.readableCodeFontSizeId !== prev.readableCodeFontSizeId
        || state.windowZoomId !== prev.windowZoomId
      ) {
        applyStoredAppearancePreference();
      }
      if (state.windowZoomId !== prev.windowZoomId) {
        applyStoredWindowZoomPreference();
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
