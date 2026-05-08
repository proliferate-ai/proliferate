import { useCallback } from "react";
import { clearWorktreeAutoDeleteLimitAdoption } from "@/lib/domain/preferences/persisted-metadata";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

export function useWorktreeAutoDeleteAdoption(): () => Promise<void> {
  return useCallback(async () => {
    const state = useUserPreferencesStore.getState();
    state.setPersistedMetadata(
      clearWorktreeAutoDeleteLimitAdoption(state._persistedMetadata),
    );
  }, []);
}
