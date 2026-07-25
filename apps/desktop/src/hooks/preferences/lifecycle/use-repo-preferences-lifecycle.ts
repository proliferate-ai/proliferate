import { useEffect } from "react";
import {
  loadRepoPreferences,
  persistRepoPreferences,
} from "@/lib/workflows/preferences/repo-preferences-persistence";
import {
  normalizeRepoConfigs,
} from "@/lib/domain/preferences/repo-preferences";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";
import { useProductStorageContext } from "@/hooks/app/facade/use-product-storage-context";

// Owns loading persisted repo preferences and syncing repo config changes.
// Does not own repository settings UI actions.
export function useRepoPreferencesLifecycle(): void {
  const persistence = useProductStorageContext();

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const startingRevision = useRepoPreferencesStore.getState()._persistenceRevision;

    const bootstrap = async () => {
      const repoConfigs = await loadRepoPreferences(persistence);
      if (cancelled) {
        return;
      }
      const current = useRepoPreferencesStore.getState();
      const liveStateWon = current._persistenceRevision !== startingRevision;
      const reconciledRepoConfigs = normalizeRepoConfigs(
        liveStateWon ? current.repoConfigs : repoConfigs,
      );
      current.hydrate(reconciledRepoConfigs);

      unsubscribe = useRepoPreferencesStore.subscribe((state, prev) => {
        if (
          !state._hydrated
          || !prev._hydrated
          || state._persistenceRevision === prev._persistenceRevision
        ) {
          return;
        }
        void persistRepoPreferences(state.repoConfigs, persistence);
      });

      if (liveStateWon) {
        void persistRepoPreferences(reconciledRepoConfigs, persistence);
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [persistence]);
}
