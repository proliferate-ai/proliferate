import { useCallback } from "react";
import { useSyncExternalStore } from "react";
import {
  subscribe,
  getResolvedMode,
} from "@/config/theme";
import type { ThemePreset, ColorMode } from "@/config/theme";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

export function useThemePreset(): [ThemePreset, (p: ThemePreset) => void] {
  const preset = useUserPreferencesStore((state) => state.themePreset);
  const setPreference = useUserPreferencesStore((state) => state.set);
  const set = useCallback((value: ThemePreset) => {
    setPreference("themePreset", value);
  }, [setPreference]);
  return [preset, set];
}

export function useColorMode(): [ColorMode, (m: ColorMode) => void] {
  const mode = useUserPreferencesStore((state) => state.colorMode);
  const setPreference = useUserPreferencesStore((state) => state.set);
  const set = useCallback((value: ColorMode) => {
    setPreference("colorMode", value);
  }, [setPreference]);
  return [mode, set];
}

export function useResolvedMode(): "dark" | "light" {
  const mode = useSyncExternalStore(subscribe, getResolvedMode, getResolvedMode);
  return mode;
}
