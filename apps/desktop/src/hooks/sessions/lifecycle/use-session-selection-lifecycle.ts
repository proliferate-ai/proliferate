import { useEffect } from "react";
import {
  isPersistableLogicalWorkspaceSelection,
  normalizePersistedLogicalWorkspaceSelection,
} from "@/lib/domain/workspaces/selection/persisted-logical-workspace-selection";
import {
  readProductStorageJson,
  writeProductStorageJson,
} from "@/lib/infra/persistence/product-storage";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useProductStorageContext } from "@/hooks/app/facade/use-product-storage-context";

const LOGICAL_WORKSPACE_SELECTION_KEY = "selected_logical_workspace_id";

// Owns persisted logical workspace selection loading and store-to-disk sync.
// Does not own workspace/session activation or runtime selection workflows.
export function useSessionSelectionLifecycle(): void {
  const persistence = useProductStorageContext();

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const startingRevision = useSessionSelectionStore.getState()._persistenceRevision;

    const hydrate = async () => {
      const persistedSelection = await readProductStorageJson<unknown>(
        persistence,
        LOGICAL_WORKSPACE_SELECTION_KEY,
      );
      const selectedLogicalWorkspaceId = typeof persistedSelection === "string"
        ? persistedSelection
        : null;

      if (cancelled) {
        return;
      }

      const current = useSessionSelectionStore.getState();
      const liveStateWon = current._persistenceRevision !== startingRevision;
      const selection = liveStateWon
        ? current.selectedLogicalWorkspaceId
        : normalizePersistedLogicalWorkspaceSelection(selectedLogicalWorkspaceId);
      current.hydrateSelectedLogicalWorkspaceSelection(selection);

      unsubscribe = useSessionSelectionStore.subscribe((state, prev) => {
        if (
          !state._hydrated
          || state._persistenceRevision === prev._persistenceRevision
        ) {
          return;
        }

        if (!isPersistableLogicalWorkspaceSelection(state.selectedLogicalWorkspaceId)) {
          return;
        }

        void writeProductStorageJson(
          persistence,
          LOGICAL_WORKSPACE_SELECTION_KEY,
          state.selectedLogicalWorkspaceId,
        );
      });

      if (liveStateWon && isPersistableLogicalWorkspaceSelection(selection)) {
        void writeProductStorageJson(
          persistence,
          LOGICAL_WORKSPACE_SELECTION_KEY,
          selection,
        );
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [persistence]);
}
