import {
  anyHarnessRuntimeWorkspacesKey,
  anyHarnessWorktreesInventoryKey,
  anyHarnessWorktreesRetentionPolicyKey,
} from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  worktreeSettingsTargetInventoryKey,
  worktreeSettingsTargetRetentionPolicyKey,
} from "@/hooks/access/anyharness/worktrees/query-keys";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/cache/query-keys";
import type { WorktreeSettingsTarget } from "@/lib/domain/workspaces/worktrees/worktree-settings-target";

// Owns cache invalidation for the product-composed Worktree Settings target view.
export function useWorktreeSettingsTargetCache(workspaceCollectionsRuntimeUrl: string | null) {
  const queryClient = useQueryClient();

  return useCallback(async (target: WorktreeSettingsTarget) => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: worktreeSettingsTargetInventoryKey(target),
      }),
      queryClient.invalidateQueries({
        queryKey: worktreeSettingsTargetRetentionPolicyKey(target),
      }),
      queryClient.invalidateQueries({
        queryKey: anyHarnessWorktreesInventoryKey(target.runtimeUrl),
      }),
      queryClient.invalidateQueries({
        queryKey: anyHarnessWorktreesRetentionPolicyKey(target.runtimeUrl),
      }),
      queryClient.invalidateQueries({
        queryKey: anyHarnessRuntimeWorkspacesKey(target.runtimeUrl),
      }),
      queryClient.invalidateQueries({
        queryKey: workspaceCollectionsScopeKey(workspaceCollectionsRuntimeUrl ?? target.runtimeUrl),
      }),
    ]);
  }, [queryClient, workspaceCollectionsRuntimeUrl]);
}
