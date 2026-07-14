import { useCallback } from "react";
import { useProductStorageContext } from "@/hooks/persistence/use-product-storage-context";
import {
  clearWorktreeAutoDeleteLimitAdoption,
  selectPersistedUserPreferencesSlice,
} from "@/lib/domain/preferences/persisted-metadata";
import { persistUserPreferences } from "@/lib/workflows/preferences/user-preferences-persistence";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

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
