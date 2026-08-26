import type {
  PruneOrphanWorktreeRequest,
  WorkspacePurgeResponse,
} from "@anyharness/sdk";
import { useCallback, useMemo } from "react";
import { useWorktreeTargetActions } from "#product/hooks/access/anyharness/worktrees/use-worktree-target-actions";
import {
  type WorktreeTargetInventoryState,
  useWorktreeTargetInventories,
} from "#product/hooks/access/anyharness/worktrees/use-worktree-target-inventories";
import { useWorktreeSettingsTargetCache } from "#product/hooks/workspaces/cache/use-worktree-settings-target-cache";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import {
  buildLocalWorktreeSettingsTarget,
  type WorktreeSettingsTarget,
} from "#product/lib/domain/workspaces/worktrees/worktree-settings-target";

const EMPTY_TARGETS: WorktreeSettingsTarget[] = [];
export type WorktreeSettingsTargetState = WorktreeTargetInventoryState;

// Owns the Settings pane target view: local runtime discovery plus worktree
// management actions for the discovered runtime. Cloud runtime discovery died
// with the cloud sandbox stack — the local desktop runtime is the only target.
export function useWorktreeSettingsTargets() {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const refreshTarget = useWorktreeSettingsTargetCache(runtimeUrl);
  const {
    pruneOrphan: pruneOrphanWorktree,
    purgeWorkspaceHistory,
  } = useWorktreeTargetActions();

  const targets = useMemo(() => {
    const trimmedRuntimeUrl = runtimeUrl.trim();
    if (trimmedRuntimeUrl.length === 0) {
      return EMPTY_TARGETS;
    }
    return [buildLocalWorktreeSettingsTarget(trimmedRuntimeUrl)];
  }, [runtimeUrl]);

  const targetStates = useWorktreeTargetInventories(targets);

  const pruneOrphan = useCallback(async (
    target: WorktreeSettingsTarget,
    input: PruneOrphanWorktreeRequest,
  ) => {
    await pruneOrphanWorktree(target, input);
    await refreshTarget(target);
  }, [pruneOrphanWorktree, refreshTarget]);

  const purgeWorkspace = useCallback(async (
    target: WorktreeSettingsTarget,
    workspaceId: string,
  ): Promise<WorkspacePurgeResponse> => {
    const result = await purgeWorkspaceHistory(target, workspaceId);
    await refreshTarget(target);
    return result;
  }, [purgeWorkspaceHistory, refreshTarget]);

  return {
    targets: targetStates,
    isDiscovering: false,
    pruneOrphan,
    purgeWorkspace,
  };
}
