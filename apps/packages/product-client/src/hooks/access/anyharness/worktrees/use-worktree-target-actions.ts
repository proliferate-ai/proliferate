import type { PruneOrphanWorktreeRequest } from "@anyharness/sdk";
import { useCallback } from "react";
import { pruneOrphanWorktree } from "#product/lib/access/anyharness/worktrees";
import {
  purgeWorkspace,
  retryPurgeWorkspace,
} from "#product/lib/access/anyharness/workspaces";
import {
  type WorktreeSettingsTarget,
  worktreeSettingsTargetRuntimeConnection,
} from "#product/lib/domain/workspaces/worktrees/worktree-settings-target";

export function useWorktreeTargetActions() {
  const pruneOrphan = useCallback((
    target: WorktreeSettingsTarget,
    input: PruneOrphanWorktreeRequest,
  ) => pruneOrphanWorktree(worktreeSettingsTargetRuntimeConnection(target), input), []);

  const purgeWorkspaceHistory = useCallback((
    target: WorktreeSettingsTarget,
    workspaceId: string,
  ) => purgeWorkspace(worktreeSettingsTargetRuntimeConnection(target), workspaceId), []);

  const retryWorkspacePurge = useCallback((
    target: WorktreeSettingsTarget,
    workspaceId: string,
  ) => retryPurgeWorkspace(worktreeSettingsTargetRuntimeConnection(target), workspaceId), []);

  return {
    pruneOrphan,
    purgeWorkspaceHistory,
    retryWorkspacePurge,
  };
}
