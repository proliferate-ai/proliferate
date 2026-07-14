import { useMemo } from "react";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { findLogicalWorkspace } from "#product/lib/domain/workspaces/cloud/logical-workspace-lookup";
import { useLogicalWorkspaces } from "#product/hooks/workspaces/derived/use-logical-workspaces";

export function useSelectedLogicalWorkspace() {
  const selectedLogicalWorkspaceId = useSessionSelectionStore((state) => state.selectedLogicalWorkspaceId);
  const { logicalWorkspaces, isLoading } = useLogicalWorkspaces();

  const selectedLogicalWorkspace = useMemo(
    () => findLogicalWorkspace(logicalWorkspaces, selectedLogicalWorkspaceId),
    [logicalWorkspaces, selectedLogicalWorkspaceId],
  );

  return {
    selectedLogicalWorkspaceId,
    selectedLogicalWorkspace,
    isLoading,
  };
}
