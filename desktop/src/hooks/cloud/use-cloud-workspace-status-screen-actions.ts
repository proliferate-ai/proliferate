import { useCallback } from "react";
import { useCloudWorkspaceActions } from "@/hooks/cloud/use-cloud-workspace-actions";
import type { CloudWorkspaceStatusScreenMode } from "@/lib/domain/workspaces/cloud-workspace-status-presentation";

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
  const { isStartingCloudWorkspace, startCloudWorkspace } = useCloudWorkspaceActions();

  const handlePrimaryAction = useCallback(() => {
    void startCloudWorkspace(workspaceId);
  }, [startCloudWorkspace, workspaceId]);

  if (mode === "pending" || mode === "blocked" || mode === "archived") {
    return {
      isPrimaryActionPending: false,
      handlePrimaryAction: null,
    };
  }

  return {
    isPrimaryActionPending: isStartingCloudWorkspace,
    handlePrimaryAction,
  };
}
