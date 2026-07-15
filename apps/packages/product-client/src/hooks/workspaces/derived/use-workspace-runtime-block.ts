import { useCallback } from "react";
import { useWorkspaces } from "#product/hooks/workspaces/cache/use-workspaces";
import {
  WORKTREE_MISSING_SEND_BLOCKED_REASON,
  isWorkspaceDirectoryMissing,
} from "#product/lib/domain/workspaces/availability";
import { parseCloudWorkspaceSyntheticId } from "#product/lib/domain/workspaces/cloud/cloud-ids";
import { useSelectedCloudRuntimeState } from "#product/hooks/workspaces/facade/use-selected-cloud-runtime-state";

export function useWorkspaceRuntimeBlock() {
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const { data: workspaceCollections } = useWorkspaces();

  const getWorkspaceRuntimeBlockReason = useCallback((workspaceId: string | null | undefined) => {
    if (
      workspaceId
      && selectedCloudRuntime.workspaceId === workspaceId
      && selectedCloudRuntime.state
      && selectedCloudRuntime.state.phase !== "ready"
    ) {
      return selectedCloudRuntime.state.actionBlockReason ?? "Cloud workspace is reconnecting.";
    }

    const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(workspaceId);
    if (!cloudWorkspaceId) {
      // Local pre-flight for the runtime's own gate: refusing here keeps the
      // failed create from ever projecting a session client-side.
      const localWorkspace = workspaceCollections?.workspaces.find(
        (workspace) => workspace.id === workspaceId,
      );
      if (isWorkspaceDirectoryMissing(localWorkspace)) {
        return WORKTREE_MISSING_SEND_BLOCKED_REASON;
      }
      return null;
    }

    const cloudWorkspace = workspaceCollections?.cloudWorkspaces.find(
      (workspace) => workspace.id === cloudWorkspaceId,
    );
    if (cloudWorkspace?.actionBlockKind) {
      return cloudWorkspace.actionBlockReason ?? "Cloud usage is currently paused.";
    }

    return null;
  }, [
    selectedCloudRuntime.state,
    selectedCloudRuntime.workspaceId,
    workspaceCollections?.cloudWorkspaces,
    workspaceCollections?.workspaces,
  ]);

  return {
    selectedCloudRuntime,
    getWorkspaceRuntimeBlockReason,
  };
}
