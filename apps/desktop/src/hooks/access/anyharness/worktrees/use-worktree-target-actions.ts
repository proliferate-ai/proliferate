import type {
  PruneOrphanWorktreeRequest,
  UpdateWorktreeRetentionPolicyRequest,
} from "@anyharness/sdk";
import { useCallback } from "react";
import {
  pruneOrphanWorktree,
  runWorktreeRetention,
  updateWorktreeRetentionPolicy,
} from "@/lib/access/anyharness/worktrees";
import {
  purgeWorkspace,
  retryPurgeWorkspace,
  retireWorkspace,
} from "@/lib/access/anyharness/workspaces";
import {
  type WorktreeSettingsTarget,
  worktreeSettingsTargetRuntimeConnection,
} from "@/lib/domain/workspaces/worktrees/worktree-settings-target";

export function useWorktreeTargetActions() {
  const updateRetentionPolicy = useCallback((
    target: WorktreeSettingsTarget,
    request: UpdateWorktreeRetentionPolicyRequest,
  ) => updateWorktreeRetentionPolicy(
    worktreeSettingsTargetRuntimeConnection(target),
    request,
  ), []);

  const runRetention = useCallback((target: WorktreeSettingsTarget) =>
    runWorktreeRetention(worktreeSettingsTargetRuntimeConnection(target)), []);

  const pruneOrphan = useCallback((
    target: WorktreeSettingsTarget,
    input: PruneOrphanWorktreeRequest,
  ) => pruneOrphanWorktree(worktreeSettingsTargetRuntimeConnection(target), input), []);

  const pruneWorkspaceCheckout = useCallback((
    target: WorktreeSettingsTarget,
    workspaceId: string,
  ) => retireWorkspace(worktreeSettingsTargetRuntimeConnection(target), workspaceId), []);

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
    pruneWorkspaceCheckout,
    purgeWorkspaceHistory,
    retryWorkspacePurge,
    runRetention,
    updateRetentionPolicy,
  };
}
