import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

export function useTransparentChromeEnabled(): boolean {
  return useUserPreferencesStore((state) => state.transparentChromeEnabled);
}
