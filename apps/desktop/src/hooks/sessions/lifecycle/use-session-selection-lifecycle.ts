import { useEffect } from "react";
import { useProductStorageContext } from "@/hooks/persistence/facade/use-product-storage-context";
import {
  isPersistableLogicalWorkspaceSelection,
  normalizePersistedLogicalWorkspaceSelection,
} from "@/lib/domain/workspaces/selection/persisted-logical-workspace-selection";
import {
  readPersistedStringValue,
  removePersistedKey,
  writePersistedString,
} from "@/lib/infra/persistence/product-storage";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

const LOGICAL_WORKSPACE_SELECTION_KEY = "selected_logical_workspace_id";

// Owns persisted logical workspace selection loading and store-to-disk sync.
// Does not own workspace/session activation or runtime selection workflows.
export function useSessionSelectionLifecycle(): void {
  const storage = useProductStorageContext();

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    const hydrate = async () => {
      // Stored as a bare workspace-id string (never JSON), so read/write it raw
      // to preserve the existing on-disk value with zero migration.
      const selectedLogicalWorkspaceId =
        (await readPersistedStringValue(storage, LOGICAL_WORKSPACE_SELECTION_KEY))
        ?? null;

      if (cancelled) {
        return;
      }

      useSessionSelectionStore.getState().hydrateSelectedLogicalWorkspaceSelection(
        normalizePersistedLogicalWorkspaceSelection(selectedLogicalWorkspaceId),
      );

      unsubscribe = useSessionSelectionStore.subscribe((state, prev) => {
        if (
          !state._hydrated
          || state.selectedLogicalWorkspaceId === prev.selectedLogicalWorkspaceId
        ) {
          return;
        }

        if (!isPersistableLogicalWorkspaceSelection(state.selectedLogicalWorkspaceId)) {
          return;
        }

        if (state.selectedLogicalWorkspaceId === null) {
          // Clearing selection: remove the key (the legacy backend stored a
          // literal null; a removed key hydrates back to the same null state).
          void removePersistedKey(storage, LOGICAL_WORKSPACE_SELECTION_KEY);
          return;
        }

        void writePersistedString(
          storage,
          LOGICAL_WORKSPACE_SELECTION_KEY,
          state.selectedLogicalWorkspaceId,
        );
      });
    };

    void hydrate();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [storage]);
}
