import type {
  HealthResponse,
  PruneOrphanWorktreeRequest,
  RunWorktreeRetentionResponse,
  RuntimeResourcePressure,
  WorkspacePurgeResponse,
  WorkspaceRetireResponse,
  WorktreeInventoryRow,
} from "@anyharness/sdk";
import { useCallback, useMemo } from "react";
import { useWorktreeTargetHealth } from "@/hooks/access/anyharness/worktrees/use-worktree-target-health";
import { useSelectedLogicalWorkspace } from "@/hooks/workspaces/derived/use-selected-logical-workspace";
import { useWorktreeSettingsTargets } from "@/hooks/workspaces/facade/use-worktree-settings-targets";
import {
  WORKTREE_AUTO_DELETE_LIMIT_DEFAULT,
} from "@/lib/domain/preferences/user/worktree-auto-delete";
import {
  worktreeRetentionRunMessage,
  worktreeSettingsActionFailureMessage,
} from "@/lib/domain/workspaces/sidebar/worktree-settings-actions";
import type { WorktreeSettingsTarget } from "@/lib/domain/workspaces/worktrees/worktree-settings-target";
import { useToastStore } from "@/stores/toast/toast-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

export type RuntimePressureTone = "success" | "warning" | "destructive" | "quiet";

export interface RuntimePressureTargetState {
  target: WorktreeSettingsTarget;
  inventory: WorktreeInventoryRow[];
  isLoading: boolean;
  error: Error | null;
  inventoryLoading: boolean;
  inventoryError: Error | null;
  healthLoading: boolean;
  healthError: Error | null;
  worktreeCount: number;
  totalWorktreeCount: number;
  pressureRepoLabel: string | null;
  idealWorktreeCount: number;
  pressurePercent: number | null;
  pressureLimitPercent: number;
  ringProgressPercent: number | null;
  pressureLabel: string;
  detailLines: string[];
  tone: RuntimePressureTone;
  resourcePressure: RuntimeResourcePressure | null;
}

export interface RuntimePressureControlState {
  visible: boolean;
  indicator: RuntimePressureTargetState | null;
  targets: RuntimePressureTargetState[];
  isDiscovering: boolean;
  actions: {
    runCleanup: (target: WorktreeSettingsTarget) => void;
    pruneOrphan: (target: WorktreeSettingsTarget, input: PruneOrphanWorktreeRequest) => void;
    pruneWorkspace: (target: WorktreeSettingsTarget, workspaceId: string) => void;
    purgeWorkspace: (target: WorktreeSettingsTarget, workspaceId: string) => void;
    retryPurge: (target: WorktreeSettingsTarget, workspaceId: string) => void;
  };
}

const EMPTY_ROWS: WorktreeInventoryRow[] = [];

export function useRuntimePressureControlState(): RuntimePressureControlState {
  const settings = useWorktreeSettingsTargets();
  const selected = useSelectedLogicalWorkspace();
  const idealWorktreeCount = useUserPreferencesStore(
    (state) => state.worktreeAutoDeleteLimit ?? WORKTREE_AUTO_DELETE_LIMIT_DEFAULT,
  );
  const showToast = useToastStore((state) => state.show);
  const targetStates = settings.targets;
  const targets = useMemo(
    () => targetStates.map((targetState) => targetState.target),
    [targetStates],
  );
  const healthStates = useWorktreeTargetHealth(targets);
  const healthByKey = useMemo(() => new Map(
    healthStates.map((state) => [state.target.key, state]),
  ), [healthStates]);

  const combinedTargets = useMemo<RuntimePressureTargetState[]>(() => (
    targetStates.map((targetState) => {
      const healthState = healthByKey.get(targetState.target.key) ?? null;
      return pressureTargetState({
        target: targetState.target,
        inventory: targetState.inventory?.rows ?? EMPTY_ROWS,
        inventoryLoading: targetState.isLoading,
        inventoryError: targetState.error,
        health: healthState?.health ?? null,
        healthLoading: healthState?.isLoading ?? false,
        healthError: healthState?.error ?? null,
        idealWorktreeCount,
      });
    })
  ), [healthByKey, idealWorktreeCount, targetStates]);

  const indicator = useMemo(() => {
    const selectedEnvironmentId =
      selected.selectedLogicalWorkspace?.cloudWorkspace?.runtime?.environmentId ?? null;
    if (selected.selectedLogicalWorkspace?.effectiveOwner === "cloud") {
      const cloudTarget = combinedTargets.find((target) => (
        target.target.location === "cloud"
        && (
          (selectedEnvironmentId && target.target.environmentId === selectedEnvironmentId)
          || (!selectedEnvironmentId && target.target.location === "cloud")
        )
      ));
      if (cloudTarget) {
        return cloudTarget;
      }
    }
    return combinedTargets.find((target) => target.target.location === "local")
      ?? combinedTargets[0]
      ?? null;
  }, [combinedTargets, selected.selectedLogicalWorkspace]);

  const runAction = useCallback(<TResult,>(
    operation: () => Promise<TResult>,
    success: string | ((result: TResult) => string),
  ) => {
    void operation().then((result) => {
      const failureMessage = worktreeSettingsActionFailureMessage(result);
      if (failureMessage) {
        showToast(failureMessage);
        return;
      }
      showToast(typeof success === "function" ? success(result) : success);
    }).catch((error) => {
      showToast(error instanceof Error ? error.message : String(error));
    });
  }, [showToast]);

  const runCleanup = useCallback((target: WorktreeSettingsTarget) => {
    runAction<RunWorktreeRetentionResponse>(
      () => settings.runRetention(target, idealWorktreeCount),
      worktreeRetentionRunMessage,
    );
  }, [idealWorktreeCount, runAction, settings]);

  const pruneOrphan = useCallback((
    target: WorktreeSettingsTarget,
    input: PruneOrphanWorktreeRequest,
  ) => {
    runAction(
      () => settings.pruneOrphan(target, input),
      "Worktree checkout removed.",
    );
  }, [runAction, settings]);

  const pruneWorkspace = useCallback((target: WorktreeSettingsTarget, workspaceId: string) => {
    runAction<WorkspaceRetireResponse>(
      () => settings.pruneWorkspaceCheckout(target, workspaceId),
      "Workspace checkout removed.",
    );
  }, [runAction, settings]);

  const purgeWorkspace = useCallback((target: WorktreeSettingsTarget, workspaceId: string) => {
    runAction<WorkspacePurgeResponse>(
      () => settings.purgeWorkspace(target, workspaceId),
      "Runtime workspace history deleted.",
    );
  }, [runAction, settings]);

  const retryPurge = useCallback((target: WorktreeSettingsTarget, workspaceId: string) => {
    runAction<WorkspacePurgeResponse>(
      () => settings.retryPurge(target, workspaceId),
      "Purge retry finished.",
    );
  }, [runAction, settings]);

  return {
    visible: combinedTargets.length > 0,
    indicator,
    targets: combinedTargets,
    isDiscovering: settings.isDiscovering,
    actions: {
      runCleanup,
      pruneOrphan,
      pruneWorkspace,
      purgeWorkspace,
      retryPurge,
    },
  };
}

function pressureTargetState({
  target,
  inventory,
  inventoryLoading,
  inventoryError,
  health,
  healthLoading,
  healthError,
  idealWorktreeCount,
}: {
  target: WorktreeSettingsTarget;
  inventory: WorktreeInventoryRow[];
  inventoryLoading: boolean;
  inventoryError: Error | null;
  health: HealthResponse | null;
  healthLoading: boolean;
  healthError: Error | null;
  idealWorktreeCount: number;
}): RuntimePressureTargetState {
  const worktreeStats = materializedWorktreeStats(inventory);
  const worktreeCount = target.location === "local"
    ? worktreeStats.maxRepoCount
    : worktreeStats.totalCount;
  const worktreePercent = idealWorktreeCount > 0
    ? (worktreeCount / idealWorktreeCount) * 100
    : null;
  const resourcePressure = health?.resourcePressure ?? null;
  const cloudPressurePercent = target.location === "cloud"
    ? resourcePressure?.pressurePercent ?? null
    : null;
  const pressurePercent = target.location === "cloud"
    ? cloudPressurePercent
    : worktreePercent;
  const pressureLimitPercent = target.location === "cloud"
    ? cloudPressureLimitPercent(resourcePressure)
    : 100;
  const ringProgressPercent = pressureProgressPercent(pressurePercent, pressureLimitPercent);
  const tone = pressureTone(pressurePercent, pressureLimitPercent);
  const pressureLabel = target.location === "cloud"
    ? cloudPressurePercent === null
      ? "Pressure unavailable"
      : `${formatPercent(cloudPressurePercent)} pressure`
    : `${worktreeCount}/${idealWorktreeCount} worktrees`;
  const detailLines = target.location === "cloud"
    ? cloudDetailLines(resourcePressure, worktreeStats.totalCount)
    : localDetailLines(
      worktreeCount,
      worktreeStats.totalCount,
      worktreeStats.maxRepoLabel,
      idealWorktreeCount,
      worktreePercent,
    );

  return {
    target,
    inventory,
    isLoading: inventoryLoading || healthLoading,
    error: inventoryError ?? healthError,
    inventoryLoading,
    inventoryError,
    healthLoading,
    healthError,
    worktreeCount,
    totalWorktreeCount: worktreeStats.totalCount,
    pressureRepoLabel: worktreeStats.maxRepoLabel,
    idealWorktreeCount,
    pressurePercent,
    pressureLimitPercent,
    ringProgressPercent,
    pressureLabel,
    detailLines,
    tone,
    resourcePressure,
  };
}

function materializedWorktreeStats(inventory: WorktreeInventoryRow[]): {
  totalCount: number;
  maxRepoCount: number;
  maxRepoLabel: string | null;
} {
  const byRepo = new Map<string, { count: number; label: string }>();
  let totalCount = 0;

  for (const row of inventory) {
    if (!row.materialized || row.associatedWorkspaces.length === 0) {
      continue;
    }
    totalCount += 1;
    const repoKey = row.repoRootId ?? row.repoRootName ?? row.path;
    const repoLabel = worktreeRepoLabel(row);
    const current = byRepo.get(repoKey);
    byRepo.set(repoKey, {
      count: (current?.count ?? 0) + 1,
      label: current?.label ?? repoLabel,
    });
  }

  let maxRepoCount = 0;
  let maxRepoLabel: string | null = null;
  for (const repo of byRepo.values()) {
    if (repo.count > maxRepoCount) {
      maxRepoCount = repo.count;
      maxRepoLabel = repo.label;
    }
  }

  return { totalCount, maxRepoCount, maxRepoLabel };
}

function worktreeRepoLabel(row: WorktreeInventoryRow): string {
  if (row.repoRootName) {
    return row.repoRootName;
  }
  const normalizedPath = row.path.replaceAll("\\", "/");
  const parts = normalizedPath.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "Unknown repo";
}

function pressureTone(percent: number | null, limitPercent: number): RuntimePressureTone {
  if (percent === null || !Number.isFinite(percent)) {
    return "quiet";
  }
  if (percent >= limitPercent) {
    return "destructive";
  }
  if (percent >= limitPercent * 0.8) {
    return "warning";
  }
  return "success";
}

function pressureProgressPercent(
  percent: number | null,
  limitPercent: number,
): number | null {
  if (percent === null || !Number.isFinite(percent) || limitPercent <= 0) {
    return null;
  }
  return Math.max(0, Math.min(100, (percent / limitPercent) * 100));
}

function cloudPressureLimitPercent(pressure: RuntimeResourcePressure | null): number {
  if (!pressure) {
    return 100;
  }
  const cpuPercent = pressure.cpu?.normalizedPercent ?? null;
  const memoryPercent = pressure.memory?.percent ?? null;
  if (cpuPercent !== null && memoryPercent !== null) {
    return cpuPercent >= memoryPercent
      ? pressure.cpu?.idealMaxPercent ?? 100
      : pressure.memory?.idealMaxPercent ?? 100;
  }
  if (cpuPercent !== null) {
    return pressure.cpu?.idealMaxPercent ?? 100;
  }
  if (memoryPercent !== null) {
    return pressure.memory?.idealMaxPercent ?? 100;
  }
  return 100;
}

function localDetailLines(
  worktreeCount: number,
  totalWorktreeCount: number,
  repoLabel: string | null,
  idealWorktreeCount: number,
  worktreePercent: number | null,
): string[] {
  return [
    repoLabel
      ? `${worktreeCount} materialized worktrees in ${repoLabel}`
      : `${worktreeCount} materialized worktrees`,
    `${totalWorktreeCount} materialized worktrees total`,
    `Ideal max ${idealWorktreeCount}`,
    worktreePercent === null ? "No percentage available" : `${formatPercent(worktreePercent)} of ideal`,
  ];
}

function cloudDetailLines(
  pressure: RuntimeResourcePressure | null,
  totalWorktreeCount: number,
): string[] {
  if (!pressure) {
    return [
      "Runtime pressure unavailable",
      `${totalWorktreeCount} materialized worktrees`,
    ];
  }
  return [
    pressure.cpu
      ? `CPU ${formatPercent(pressure.cpu.normalizedPercent)} of ${formatPercent(pressure.cpu.idealMaxPercent)} ideal`
      : "CPU unavailable",
    pressure.memory
      ? `RAM ${formatPercent(pressure.memory.percent)} of ${formatPercent(pressure.memory.idealMaxPercent)} ideal`
      : "RAM unavailable",
    `${totalWorktreeCount} materialized worktrees`,
  ];
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}
