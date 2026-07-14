import { useEffect } from "react";
import { useProductStorageContext } from "@/hooks/persistence/use-product-storage-context";
import {
  loadRepoPreferences,
  persistRepoPreferences,
} from "@/lib/workflows/preferences/repo-preferences-persistence";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";

// Owns loading persisted repo preferences and syncing repo config changes.
// Does not own repository settings UI actions.
export function useRepoPreferencesLifecycle(): void {
  const storage = useProductStorageContext();

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    const bootstrap = async () => {
      const repoConfigs = await loadRepoPreferences(storage);
      if (cancelled) {
        return;
      }

      useRepoPreferencesStore.getState().hydrate(repoConfigs);
      unsubscribe = useRepoPreferencesStore.subscribe((state, prev) => {
        if (!state._hydrated || !prev._hydrated || state.repoConfigs === prev.repoConfigs) {
          return;
        }
        void persistRepoPreferences(storage, state.repoConfigs);
      });
    };

    void bootstrap();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [storage]);
}
