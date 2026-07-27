import { useCallback } from "react";
import { useCloudWorkspaceActions } from "#product/hooks/cloud/workflows/use-cloud-workspace-actions";
import type { CloudWorkspaceStatusScreenMode } from "#product/lib/domain/workspaces/cloud/cloud-workspace-status-presentation";

export function useCloudWorkspaceStatusScreenActions({
  workspaceId,
  mode,
}: {
  workspaceId: string;
  mode: CloudWorkspaceStatusScreenMode;
}): {
  isPrimaryActionPending: boolean;
  handlePrimaryAction: (() => void) | null;
} {
  const {
    deleteCloudWorkspace,
    isDeletingCloudWorkspace,
    isRefreshingCloudWorkspace,
    refreshCloudWorkspace,
  } = useCloudWorkspaceActions();

  const handlePrimaryAction = useCallback(() => {
    if (mode === "lost") {
      void deleteCloudWorkspace(workspaceId);
      return;
    }
    void refreshCloudWorkspace(workspaceId);
  }, [deleteCloudWorkspace, mode, refreshCloudWorkspace, workspaceId]);

  if (mode === "pending" || mode === "blocked" || mode === "archived") {
    return {
      isPrimaryActionPending: false,
      handlePrimaryAction: null,
    };
  }

  return {
    isPrimaryActionPending: mode === "lost"
      ? isDeletingCloudWorkspace
      : isRefreshingCloudWorkspace,
    handlePrimaryAction,
  };
}
