import type { WorktreeInventoryResponse } from "@anyharness/sdk";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { getWorktreeInventory } from "@/lib/access/anyharness/worktrees";
import {
  type WorktreeSettingsTarget,
  worktreeSettingsTargetRuntimeConnection,
} from "@/lib/domain/workspaces/worktrees/worktree-settings-target";
import { worktreeSettingsTargetInventoryKey } from "./query-keys";

export interface WorktreeTargetInventoryState {
  target: WorktreeSettingsTarget;
  inventory: WorktreeInventoryResponse | null;
  isLoading: boolean;
  error: Error | null;
}

export function useWorktreeTargetInventories(
  targets: WorktreeSettingsTarget[],
): WorktreeTargetInventoryState[] {
  const inventoryQueries = useQueries({
    queries: targets.map((target) => ({
      queryKey: worktreeSettingsTargetInventoryKey(target),
      queryFn: async ({ signal }): Promise<WorktreeInventoryResponse> => {
        return getWorktreeInventory(
          worktreeSettingsTargetRuntimeConnection(target),
          { signal },
        );
      },
      enabled: target.runtimeUrl.trim().length > 0,
    })),
  });

  return useMemo<WorktreeTargetInventoryState[]>(() => targets.map((target, index) => {
    const query = inventoryQueries[index];
    return {
      target,
      inventory: query?.data ?? null,
      isLoading: query?.isLoading ?? false,
      error: query?.error instanceof Error ? query.error : null,
    };
  }), [inventoryQueries, targets]);
}
