import { useMemo } from "react";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import {
  ensureRepoGroupExpanded,
  trackWorkspaceInteraction,
} from "#product/stores/preferences/workspace-ui-store";
import { getSessionRecord } from "#product/stores/sessions/session-records";
import {
  usePendingWorkspaceSessionMaterialization,
} from "#product/hooks/workspaces/workflows/use-pending-workspace-session-materialization";
import type {
  WorkspaceEntrySelectionDeps,
} from "#product/hooks/workspaces/workflows/workspace-entry-finalization";
import { useWorkspaceSelection } from "#product/hooks/workspaces/workflows/selection/use-workspace-selection";

// Stable dependency bundle consumed by the workspace-entry finalization workflows.
export function useWorkspaceEntrySelectionDeps(): WorkspaceEntrySelectionDeps {
  const { selectWorkspace } = useWorkspaceSelection();
  const materializePendingWorkspaceSessions = usePendingWorkspaceSessionMaterialization();
  const setPendingWorkspaceEntry = useSessionSelectionStore(
    (state) => state.setPendingWorkspaceEntry,
  );
  const setWorkspaceArrivalEvent = useSessionSelectionStore(
    (state) => state.setWorkspaceArrivalEvent,
  );

  return useMemo(() => ({
    expandRepoGroup: ensureRepoGroupExpanded,
    getSelectionState: useSessionSelectionStore.getState,
    getSessionRecord,
    materializePendingWorkspaceSessions,
    selectWorkspace,
    setPendingWorkspaceEntry,
    setWorkspaceArrivalEvent,
    trackWorkspaceInteraction: (workspaceId: string) =>
      trackWorkspaceInteraction(workspaceId, new Date().toISOString()),
  }), [
    materializePendingWorkspaceSessions,
    selectWorkspace,
    setPendingWorkspaceEntry,
    setWorkspaceArrivalEvent,
  ]);
}
