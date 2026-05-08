import { useEffect } from "react";
import {
  loadRepoPreferences,
  persistRepoPreferences,
} from "@/lib/workflows/preferences/repo-preferences-persistence";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";

// Owns loading persisted repo preferences and syncing repo config changes.
// Does not own repository settings UI actions.
export function useRepoPreferencesLifecycle(): void {
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    const bootstrap = async () => {
      const repoConfigs = await loadRepoPreferences();
      if (cancelled) {
        return;
      }

      useRepoPreferencesStore.getState().hydrate(repoConfigs);
      unsubscribe = useRepoPreferencesStore.subscribe((state, prev) => {
        if (!state._hydrated || !prev._hydrated || state.repoConfigs === prev.repoConfigs) {
          return;
        }
        void persistRepoPreferences(state.repoConfigs);
      });
    };

    void bootstrap();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);
}
