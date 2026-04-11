import { useMemo } from "react";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";
import { findLogicalWorkspace } from "@/lib/domain/workspaces/logical-workspaces";
import { useLogicalWorkspaces } from "./use-logical-workspaces";

export function useSelectedLogicalWorkspace() {
  const selectedLogicalWorkspaceId = useLogicalWorkspaceStore((state) => state.selectedLogicalWorkspaceId);
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
