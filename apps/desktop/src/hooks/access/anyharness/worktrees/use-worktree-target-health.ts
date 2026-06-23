import type { HealthResponse } from "@anyharness/sdk";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { getRuntimeHealth } from "@/lib/access/anyharness/runtime-health";
import {
  type WorktreeSettingsTarget,
  worktreeSettingsTargetRuntimeConnection,
} from "@/lib/domain/workspaces/worktrees/worktree-settings-target";
import { worktreeSettingsTargetHealthKey } from "./query-keys";

export interface WorktreeTargetHealthState {
  target: WorktreeSettingsTarget;
  health: HealthResponse | null;
  isLoading: boolean;
  error: Error | null;
}

export function useWorktreeTargetHealth(
  targets: WorktreeSettingsTarget[],
): WorktreeTargetHealthState[] {
  const healthQueries = useQueries({
    queries: targets.map((target) => ({
      queryKey: worktreeSettingsTargetHealthKey(target),
      queryFn: async ({ signal }): Promise<HealthResponse> => {
        return getRuntimeHealth(
          worktreeSettingsTargetRuntimeConnection(target),
          { signal },
        );
      },
      enabled: target.runtimeUrl.trim().length > 0,
      refetchInterval: target.location === "cloud" ? 10_000 : 30_000,
    })),
  });

  return useMemo<WorktreeTargetHealthState[]>(() => targets.map((target, index) => {
    const query = healthQueries[index];
    return {
      target,
      health: query?.data ?? null,
      isLoading: query?.isLoading ?? false,
      error: query?.error instanceof Error ? query.error : null,
    };
  }), [healthQueries, targets]);
}
