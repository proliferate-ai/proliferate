import { useCallback } from "react";
import { useProductStorageContext } from "#product/hooks/persistence/facade/use-product-storage-context";
import {
  clearWorktreeAutoDeleteLimitAdoption,
  selectPersistedUserPreferencesSlice,
} from "#product/lib/domain/preferences/persisted-metadata";
import { persistUserPreferences } from "#product/lib/workflows/preferences/user-preferences-persistence";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";

export function useWorktreeAutoDeleteAdoption(): () => Promise<void> {
  const storage = useProductStorageContext();
  return useCallback(async () => {
    const state = useUserPreferencesStore.getState();
    const nextMetadata = clearWorktreeAutoDeleteLimitAdoption(state._persistedMetadata);
    state.setPersistedMetadata(nextMetadata);
    await persistUserPreferences(
      storage,
      selectPersistedUserPreferencesSlice(useUserPreferencesStore.getState()),
      nextMetadata,
    );
  }, [storage]);
}
