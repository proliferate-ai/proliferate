import { useMemo } from "react";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import {
  ensureRepoGroupExpanded,
  trackWorkspaceInteraction,
} from "@/stores/preferences/workspace-ui-store";
import { getSessionRecord } from "@/stores/sessions/session-records";
import {
  usePendingWorkspaceSessionMaterialization,
} from "@/hooks/workspaces/workflows/use-pending-workspace-session-materialization";
import type {
  WorkspaceEntrySelectionDeps,
} from "@/hooks/workspaces/workflows/workspace-entry-finalization";
import { useWorkspaceSelection } from "./selection/use-workspace-selection";

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
