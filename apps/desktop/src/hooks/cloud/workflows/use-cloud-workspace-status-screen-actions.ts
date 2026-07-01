import { useCallback } from "react";
import { useCloudWorkspaceActions } from "@/hooks/cloud/workflows/use-cloud-workspace-actions";
import type { CloudWorkspaceStatusScreenMode } from "@/lib/domain/workspaces/cloud/cloud-workspace-status-presentation";

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
  const { isRefreshingCloudWorkspace, refreshCloudWorkspace } = useCloudWorkspaceActions();

  const handlePrimaryAction = useCallback(() => {
    void refreshCloudWorkspace(workspaceId);
  }, [refreshCloudWorkspace, workspaceId]);

  if (mode === "pending" || mode === "blocked" || mode === "archived") {
    return {
      isPrimaryActionPending: false,
      handlePrimaryAction: null,
    };
  }

  return {
    isPrimaryActionPending: isRefreshingCloudWorkspace,
    handlePrimaryAction,
  };
}
