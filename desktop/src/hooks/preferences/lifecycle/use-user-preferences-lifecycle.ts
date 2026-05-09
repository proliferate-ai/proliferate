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

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function persistSnapshot(
  preferences: UserPreferences,
  persistedMetadata: PersistedUserPreferencesMetadata,
): void {
  void persistUserPreferences(preferences, persistedMetadata);
}

// Owns loading persisted user preferences and syncing store changes to disk.
// Does not own preference UI actions or worktree policy adoption.
export function useUserPreferencesLifecycle(): void {
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    const bootstrap = async () => {
      const loaded = await loadUserPreferences();
      if (cancelled) {
        return;
      }

      useUserPreferencesStore.getState().hydrate(loaded);
      if (loaded.shouldPersist) {
        persistSnapshot(loaded.preferences, loaded.persistedMetadata);
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

        persistSnapshot(currentPreferences, state._persistedMetadata);
      });
    };

    void bootstrap();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);
}
