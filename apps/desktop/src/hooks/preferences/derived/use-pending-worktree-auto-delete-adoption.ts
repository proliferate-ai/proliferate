import { hasPendingWorktreeAutoDeleteLimitAdoption } from "@/lib/domain/preferences/persisted-metadata";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

export function useHasPendingWorktreeAutoDeleteAdoption(): boolean {
  return useUserPreferencesStore((state) =>
    hasPendingWorktreeAutoDeleteLimitAdoption(state._persistedMetadata)
  );
}
