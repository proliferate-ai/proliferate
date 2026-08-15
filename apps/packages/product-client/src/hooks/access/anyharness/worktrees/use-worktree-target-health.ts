import type { HealthResponse } from "@anyharness/sdk";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { getRuntimeHealth } from "#product/lib/access/anyharness/runtime-health";
import {
  type WorktreeSettingsTarget,
  worktreeSettingsTargetRuntimeConnection,
} from "#product/lib/domain/workspaces/worktrees/worktree-settings-target";
import { worktreeSettingsTargetHealthKey } from "#product/hooks/access/anyharness/worktrees/query-keys";

// Named exceptions (neither sits on the `cadence` scale). Cloud targets: 10s
// falls strictly between `cadence.standardMs` (5s) and `cadence.relaxedMs`
// (15s); snapping down to standard would tighten a cloud round-trip health
// check (forbidden), and snapping up to relaxed would leave a degraded cloud
// worktree target reading "healthy" in settings for up to 5s longer. Local
// targets: 30s falls strictly between `cadence.relaxedMs` (15s) and
// `cadence.slowMs` (60s) — the same band `WORKSPACE_COLLECTIONS_STALE_MS`
// occupies for the same reason: snapping down tightens, snapping up doubles
// the interval, more than an inconsequential loosening for a settings health
// indicator. Kept as their own named constants (UX Latency + Transitions ADR
// §4.7, Rung 6, Q8).
const CLOUD_WORKTREE_TARGET_HEALTH_POLL_MS = 10_000;
const LOCAL_WORKTREE_TARGET_HEALTH_POLL_MS = 30_000;

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
      refetchInterval: target.location === "cloud"
        ? CLOUD_WORKTREE_TARGET_HEALTH_POLL_MS
        : LOCAL_WORKTREE_TARGET_HEALTH_POLL_MS,
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
