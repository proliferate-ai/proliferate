import { useEffect } from "react";
import {
  isPersistableLogicalWorkspaceSelection,
  normalizePersistedLogicalWorkspaceSelection,
} from "@/lib/domain/workspaces/selection/persisted-logical-workspace-selection";
import { readPersistedValue, persistValue } from "@/lib/infra/persistence/preferences-persistence";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

const LOGICAL_WORKSPACE_SELECTION_KEY = "selected_logical_workspace_id";

// Owns persisted logical workspace selection loading and store-to-disk sync.
// Does not own workspace/session activation or runtime selection workflows.
export function useSessionSelectionLifecycle(): void {
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    const hydrate = async () => {
      const selectedLogicalWorkspaceId =
        (await readPersistedValue<string | null>(LOGICAL_WORKSPACE_SELECTION_KEY))
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

        void persistValue(
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
  }, []);
}
