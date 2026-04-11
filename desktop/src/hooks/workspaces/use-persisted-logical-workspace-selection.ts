import { useEffect, useRef } from "react";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";
import { useLogicalWorkspaces } from "./use-logical-workspaces";
import { useWorkspaceSelection } from "./selection/use-workspace-selection";

export function usePersistedLogicalWorkspaceSelection() {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const pendingWorkspaceEntry = useHarnessStore((state) => state.pendingWorkspaceEntry);
  const selectedLogicalWorkspaceId = useLogicalWorkspaceStore((state) => state.selectedLogicalWorkspaceId);
  const logicalStoreHydrated = useLogicalWorkspaceStore((state) => state._hydrated);
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

    if (!logicalWorkspaces.some((workspace) => workspace.id === selectedLogicalWorkspaceId)) {
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
