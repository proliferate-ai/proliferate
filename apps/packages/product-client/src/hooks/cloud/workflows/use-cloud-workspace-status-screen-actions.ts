import { useCallback } from "react";
import { useCloudWorkspaceActions } from "#product/hooks/cloud/workflows/use-cloud-workspace-actions";
import { useCloudWorkspaceBillingBlockStore } from "#product/stores/workspaces/cloud-workspace-billing-block-store";
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
    if (mode === "blocked") {
      // A billing block may have expired (top-up, admin hold lifted); clear
      // the recorded block and re-bootstrap — a still-blocked subject just
      // re-records it from the fresh 402.
      useCloudWorkspaceBillingBlockStore
        .getState()
        .clearBillingBlock(workspaceId);
    }
    void refreshCloudWorkspace(workspaceId);
  }, [deleteCloudWorkspace, mode, refreshCloudWorkspace, workspaceId]);

  if (mode === "pending" || mode === "archived") {
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
