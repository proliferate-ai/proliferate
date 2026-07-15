import { hasPendingWorktreeAutoDeleteLimitAdoption } from "#product/lib/domain/preferences/persisted-metadata";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";

export function useHasPendingWorktreeAutoDeleteAdoption(): boolean {
  return useUserPreferencesStore((state) =>
    hasPendingWorktreeAutoDeleteLimitAdoption(state._persistedMetadata)
  );
}
