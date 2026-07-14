import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";

export function useTransparentChromeEnabled(): boolean {
  return useUserPreferencesStore((state) => state.transparentChromeEnabled);
}
