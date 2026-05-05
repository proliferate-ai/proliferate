import {
  anyHarnessRuntimeWorkspacesKey,
  anyHarnessWorktreesInventoryKey,
  anyHarnessWorktreesRetentionPolicyKey,
  getAnyHarnessClient,
} from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/query-keys";
import type {
  WorktreeSettingsTarget,
  WorktreeSettingsTargetState,
} from "@/hooks/workspaces/use-worktree-settings-targets";

const EMPTY_TARGETS: WorktreeSettingsTargetState[] = [];

export function useLocalWorktreeSettingsTarget() {
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const connectionState = useHarnessStore((state) => state.connectionState);
  const queryClient = useQueryClient();

  const targets = useMemo<WorktreeSettingsTargetState[]>(() => {
    const trimmedRuntimeUrl = runtimeUrl.trim();
    if (connectionState !== "healthy" || trimmedRuntimeUrl.length === 0) {
      return EMPTY_TARGETS;
    }

    const target: WorktreeSettingsTarget = {
      key: `local:${trimmedRuntimeUrl}:generation:0`,
      label: "Local runtime",
      location: "local",
      runtimeUrl: trimmedRuntimeUrl,
      runtimeGeneration: 0,
      environmentId: null,
    };

    return [{
      target,
      inventory: null,
      isLoading: false,
      error: null,
    }];
  }, [connectionState, runtimeUrl]);

  const refreshTarget = useCallback(async (target: WorktreeSettingsTarget) => {
    await Promise.all([
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
        queryKey: workspaceCollectionsScopeKey(target.runtimeUrl),
      }),
    ]);
  }, [queryClient]);

  const syncPolicyToTarget = useCallback(async (
    target: WorktreeSettingsTarget,
    maxMaterializedWorktreesPerRepo: number,
    options: { runDeferredCleanup?: boolean } = {},
  ) => {
    const client = getAnyHarnessClient({ runtimeUrl: target.runtimeUrl });
    await client.worktrees.updateRetentionPolicy({ maxMaterializedWorktreesPerRepo });
    if (options.runDeferredCleanup) {
      await client.worktrees.runRetention();
    }
    await refreshTarget(target);
  }, [refreshTarget]);

  return {
    targets,
    syncPolicyToTarget,
  };
}
