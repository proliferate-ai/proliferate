import { useEffect, useRef } from "react";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useLogicalWorkspaces } from "@/hooks/workspaces/derived/use-logical-workspaces";
import { useWorkspaceSelection } from "@/hooks/workspaces/workflows/selection/use-workspace-selection";
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

    const resolved = findLogicalWorkspace(logicalWorkspaces, selectedLogicalWorkspaceId);
    if (!resolved) {
      return;
    }

    attemptedLogicalWorkspaceIdRef.current = selectedLogicalWorkspaceId;
    // Pass the resolved local workspace as `knownWorkspace`: selection re-derives
    // its own workspace snapshot from the query cache, which can momentarily miss
    // a workspace this reactive hook already has (e.g. right after a reload while
    // the collections cache repopulates). Without the hint, restoring the last
    // workspace on reopen would fail with "Workspace not found."
    const knownWorkspace = resolved.localWorkspace?.id === selectedLogicalWorkspaceId
      ? resolved.localWorkspace
      : null;
    void selectWorkspace(selectedLogicalWorkspaceId, { force: true, knownWorkspace }).catch(() => {
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
