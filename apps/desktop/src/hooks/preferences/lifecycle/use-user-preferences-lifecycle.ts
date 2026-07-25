import { useEffect } from "react";
import {
  selectPersistedUserPreferencesSlice,
  type PersistedUserPreferencesMetadata,
} from "@/lib/domain/preferences/persisted-metadata";
import type { UserPreferences } from "@/lib/domain/preferences/user/model";
import {
  loadUserPreferences,
  persistUserPreferences,
} from "@/lib/workflows/preferences/user-preferences-persistence";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { useProductStorageContext } from "@/hooks/app/facade/use-product-storage-context";
import type { ProductStorageContext } from "@/lib/infra/persistence/product-storage";

function persistSnapshot(
  preferences: UserPreferences,
  persistedMetadata: PersistedUserPreferencesMetadata,
  context: ProductStorageContext,
): Promise<void> {
  return persistUserPreferences(preferences, persistedMetadata, context);
}

// Owns loading persisted user preferences and syncing store changes to disk.
// Does not own preference UI actions or worktree policy adoption.
export function useUserPreferencesLifecycle(): void {
  const persistence = useProductStorageContext();

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const startingRevision = useUserPreferencesStore.getState()._persistenceRevision;

    const bootstrap = async () => {
      const loaded = await loadUserPreferences(persistence);
      if (cancelled) {
        return;
      }
      const current = useUserPreferencesStore.getState();
      const liveStateWon = current._persistenceRevision !== startingRevision;
      const preferences = liveStateWon
        ? selectPersistedUserPreferencesSlice(current)
        : loaded.preferences;
      const persistedMetadata = liveStateWon
        ? current._persistedMetadata
        : loaded.persistedMetadata;
      current.hydrate({ preferences, persistedMetadata });

      unsubscribe = useUserPreferencesStore.subscribe((state, prev) => {
        if (
          !state._hydrated
          || !prev._hydrated
          || state._persistenceRevision === prev._persistenceRevision
        ) {
          return;
        }

        const currentPreferences = selectPersistedUserPreferencesSlice(state);
        void persistSnapshot(
          currentPreferences,
          state._persistedMetadata,
          persistence,
        );
      });

      if (liveStateWon || loaded.shouldPersist) {
        void persistSnapshot(
          preferences,
          persistedMetadata,
          persistence,
        );
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [persistence]);
}
