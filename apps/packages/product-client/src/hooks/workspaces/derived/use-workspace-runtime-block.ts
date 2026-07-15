import { useCallback } from "react";
import { useWorkspaces } from "#product/hooks/workspaces/cache/use-workspaces";
import { isWorkspaceDirectoryMissing } from "#product/lib/domain/workspaces/availability";
import { missingCheckoutCopy } from "#product/copy/workspaces/workspace-availability-copy";
import { workspaceDirectoryMissingBlockError } from "#product/lib/domain/sessions/creation/create-session-error";
import { parseCloudWorkspaceSyntheticId } from "#product/lib/domain/workspaces/cloud/cloud-ids";
import { useSelectedCloudRuntimeState } from "#product/hooks/workspaces/facade/use-selected-cloud-runtime-state";

interface WorkspaceRuntimeBlock {
  reason: string;
  directoryMissing: boolean;
}

export function useWorkspaceRuntimeBlock() {
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const { data: workspaceCollections } = useWorkspaces();

  const getWorkspaceRuntimeBlock = useCallback(
    (workspaceId: string | null | undefined): WorkspaceRuntimeBlock | null => {
      if (
        workspaceId
        && selectedCloudRuntime.workspaceId === workspaceId
        && selectedCloudRuntime.state
        && selectedCloudRuntime.state.phase !== "ready"
      ) {
        return {
          reason: selectedCloudRuntime.state.actionBlockReason ?? "Cloud workspace is reconnecting.",
          directoryMissing: false,
        };
      }

      const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(workspaceId);
      if (!cloudWorkspaceId) {
        // Local pre-flight for the runtime's own gate: refusing here keeps the
        // failed create from ever projecting a session client-side.
        const localWorkspace = workspaceCollections?.workspaces.find(
          (workspace) => workspace.id === workspaceId,
        );
        if (localWorkspace && isWorkspaceDirectoryMissing(localWorkspace)) {
          return {
            reason: missingCheckoutCopy(localWorkspace.kind).sendBlockedReason,
            directoryMissing: true,
          };
        }
        return null;
      }

      const cloudWorkspace = workspaceCollections?.cloudWorkspaces.find(
        (workspace) => workspace.id === cloudWorkspaceId,
      );
      if (cloudWorkspace?.actionBlockKind) {
        return {
          reason: cloudWorkspace.actionBlockReason ?? "Cloud usage is currently paused.",
          directoryMissing: false,
        };
      }

      return null;
    },
    [
      selectedCloudRuntime.state,
      selectedCloudRuntime.workspaceId,
      workspaceCollections?.cloudWorkspaces,
      workspaceCollections?.workspaces,
    ],
  );

  const getWorkspaceRuntimeBlockReason = useCallback(
    (workspaceId: string | null | undefined) => getWorkspaceRuntimeBlock(workspaceId)?.reason ?? null,
    [getWorkspaceRuntimeBlock],
  );

  // Error form for throw sites: the missing-directory case carries the stable
  // machine code so downstream handling matches it structurally, never by
  // display copy.
  const getWorkspaceRuntimeBlockError = useCallback(
    (workspaceId: string | null | undefined): Error | null => {
      const block = getWorkspaceRuntimeBlock(workspaceId);
      if (!block) {
        return null;
      }
      return block.directoryMissing
        ? workspaceDirectoryMissingBlockError(block.reason)
        : new Error(block.reason);
    },
    [getWorkspaceRuntimeBlock],
  );

  return {
    selectedCloudRuntime,
    getWorkspaceRuntimeBlockReason,
    getWorkspaceRuntimeBlockError,
  };
}
