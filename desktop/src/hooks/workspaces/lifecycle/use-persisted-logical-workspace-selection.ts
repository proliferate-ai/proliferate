import { useEffect, useRef } from "react";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useLogicalWorkspaces } from "@/hooks/workspaces/derived/use-logical-workspaces";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import { findLogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-lookup";

export function usePersistedLogicalWorkspaceSelection() {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const pendingWorkspaceEntry = useSessionSelectionStore((state) => state.pendingWorkspaceEntry);
  const selectedLogicalWorkspaceId = useSessionSelectionStore((state) => state.selectedLogicalWorkspaceId);
  const logicalStoreHydrated = useSessionSelectionStore((state) => state._hydrated);
  const { logicalWorkspaces, isLoading } = useLogicalWorkspaces();
  const { selectWorkspace } = useWorkspaceSelection();
  const attemptedLogicalWorkspaceIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!logicalStoreHydrated || isLoading || selectedWorkspaceId || pendingWorkspaceEntry) {
      return;
    }

    if (!selectedLogicalWorkspaceId) {
      return;
    }

    if (attemptedLogicalWorkspaceIdRef.current === selectedLogicalWorkspaceId) {
      return;
    }

    if (!findLogicalWorkspace(logicalWorkspaces, selectedLogicalWorkspaceId)) {
      return;
    }

    attemptedLogicalWorkspaceIdRef.current = selectedLogicalWorkspaceId;
    void selectWorkspace(selectedLogicalWorkspaceId, { force: true }).catch(() => {
      attemptedLogicalWorkspaceIdRef.current = null;
    });
  }, [
    isLoading,
    logicalStoreHydrated,
    logicalWorkspaces,
    pendingWorkspaceEntry,
    selectWorkspace,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
  ]);
}
