import { useCallback, useMemo } from "react";
import { useWorktreeTargetActions } from "@/hooks/access/anyharness/worktrees/use-worktree-target-actions";
import type { WorktreeTargetInventoryState } from "@/hooks/access/anyharness/worktrees/use-worktree-target-inventories";
import { useWorktreeSettingsTargetCache } from "@/hooks/workspaces/cache/use-worktree-settings-target-cache";
import {
  buildLocalWorktreeSettingsTarget,
  type WorktreeSettingsTarget,
} from "@/lib/domain/workspaces/worktrees/worktree-settings-target";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

const EMPTY_TARGETS: WorktreeTargetInventoryState[] = [];

// Owns the local-runtime target view used by the global cleanup policy sync.
export function useLocalWorktreeSettingsTarget() {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const connectionState = useHarnessConnectionStore((state) => state.connectionState);
  const refreshTarget = useWorktreeSettingsTargetCache(null);
  const { runRetention, updateRetentionPolicy } = useWorktreeTargetActions();

  const targets = useMemo<WorktreeTargetInventoryState[]>(() => {
    const trimmedRuntimeUrl = runtimeUrl.trim();
    if (connectionState !== "healthy" || trimmedRuntimeUrl.length === 0) {
      return EMPTY_TARGETS;
    }

    const target = buildLocalWorktreeSettingsTarget(trimmedRuntimeUrl);

    return [{
      target,
      inventory: null,
      isLoading: false,
      error: null,
    }];
  }, [connectionState, runtimeUrl]);

  const syncPolicyToTarget = useCallback(async (
    target: WorktreeSettingsTarget,
    maxMaterializedWorktreesPerRepo: number,
    options: { runDeferredCleanup?: boolean } = {},
  ) => {
    await updateRetentionPolicy(target, { maxMaterializedWorktreesPerRepo });
    if (options.runDeferredCleanup) {
      await runRetention(target);
    }
    await refreshTarget(target);
  }, [refreshTarget, runRetention, updateRetentionPolicy]);

  return {
    targets,
    syncPolicyToTarget,
  };
}
