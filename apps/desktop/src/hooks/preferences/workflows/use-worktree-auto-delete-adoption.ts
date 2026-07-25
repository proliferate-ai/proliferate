import { useCallback } from "react";
import {
  clearWorktreeAutoDeleteLimitAdoption,
  selectPersistedUserPreferencesSlice,
} from "@/lib/domain/preferences/persisted-metadata";
import { persistUserPreferences } from "@/lib/workflows/preferences/user-preferences-persistence";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { useProductStorageContext } from "@/hooks/app/facade/use-product-storage-context";

export function useWorktreeAutoDeleteAdoption(): () => Promise<void> {
  const persistence = useProductStorageContext();
  return useCallback(async () => {
    const state = useUserPreferencesStore.getState();
    const nextMetadata = clearWorktreeAutoDeleteLimitAdoption(state._persistedMetadata);
    state.setPersistedMetadata(nextMetadata);
    await persistUserPreferences(
      selectPersistedUserPreferencesSlice(useUserPreferencesStore.getState()),
      nextMetadata,
      persistence,
    );
  }, [persistence]);
}
