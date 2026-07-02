import { useCallback } from "react";
import type { ColorMode } from "@/config/theme";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

export function useColorMode(): [ColorMode, (m: ColorMode) => void] {
  const mode = useUserPreferencesStore((state) => state.colorMode);
  const setPreference = useUserPreferencesStore((state) => state.set);
  const set = useCallback((value: ColorMode) => {
    setPreference("colorMode", value);
  }, [setPreference]);
  return [mode, set];
}
