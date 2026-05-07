import { useMemo } from "react";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { findLogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspaces";
import { useLogicalWorkspaces } from "./use-logical-workspaces";

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
