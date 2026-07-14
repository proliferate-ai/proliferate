import { useEffect } from "react";
import { useProductStorageContext } from "@/hooks/persistence/facade/use-product-storage-context";
import {
  selectPersistedUserPreferencesSlice,
  type PersistedUserPreferencesMetadata,
} from "@/lib/domain/preferences/persisted-metadata";
import type { UserPreferences } from "@/lib/domain/preferences/user/model";
import type { ProductStorageContext } from "@/lib/infra/persistence/product-storage";
import {
  loadUserPreferences,
  persistUserPreferences,
} from "@/lib/workflows/preferences/user-preferences-persistence";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function persistSnapshot(
  storage: ProductStorageContext,
  preferences: UserPreferences,
  persistedMetadata: PersistedUserPreferencesMetadata,
): void {
  void persistUserPreferences(storage, preferences, persistedMetadata);
}

// Owns loading persisted user preferences and syncing store changes to disk.
// Does not own preference UI actions or worktree policy adoption.
export function useUserPreferencesLifecycle(): void {
  const storage = useProductStorageContext();

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    const bootstrap = async () => {
      const loaded = await loadUserPreferences(storage);
      if (cancelled) {
        return;
      }

      useUserPreferencesStore.getState().hydrate(loaded);
      if (loaded.shouldPersist) {
        persistSnapshot(storage, loaded.preferences, loaded.persistedMetadata);
      }

      unsubscribe = useUserPreferencesStore.subscribe((state, prev) => {
        if (!state._hydrated || !prev._hydrated) {
          return;
        }

        const currentPreferences = selectPersistedUserPreferencesSlice(state);
        const previousPreferences = selectPersistedUserPreferencesSlice(prev);
        if (
          sameJson(currentPreferences, previousPreferences)
          && sameJson(state._persistedMetadata, prev._persistedMetadata)
        ) {
          return;
        }

        persistSnapshot(storage, currentPreferences, state._persistedMetadata);
      });
    };

    void bootstrap();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [storage]);
}
