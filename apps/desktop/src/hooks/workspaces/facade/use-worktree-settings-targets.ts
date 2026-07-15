import type {
  PruneOrphanWorktreeRequest,
  RunWorktreeRetentionResponse,
  WorkspacePurgeResponse,
  WorkspaceRetireResponse,
} from "@anyharness/sdk";
import { useQueries } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { cloudWorkspaceConnectionQueryOptions } from "@/hooks/access/cloud/use-cloud-workspace-connection";
import { useWorktreeTargetActions } from "@/hooks/access/anyharness/worktrees/use-worktree-target-actions";
import {
  type WorktreeTargetInventoryState,
  useWorktreeTargetInventories,
} from "@/hooks/access/anyharness/worktrees/use-worktree-target-inventories";
import { useWorktreeSettingsTargetCache } from "@/hooks/workspaces/cache/use-worktree-settings-target-cache";
import type { CloudConnectionInfo } from "@/lib/access/cloud/client";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { resolveCloudWorkspaceStatus } from "@/lib/domain/workspaces/cloud/cloud-workspace-status";
import {
  buildLocalWorktreeSettingsTarget,
  type WorktreeSettingsTarget,
  worktreeSettingsTargetIdentity,
} from "@/lib/domain/workspaces/worktrees/worktree-settings-target";

const EMPTY_CLOUD_WORKSPACES: NonNullable<ReturnType<typeof useWorkspaces>["data"]>["cloudWorkspaces"] = [];

const EMPTY_TARGETS: WorktreeSettingsTarget[] = [];
export type WorktreeSettingsTargetState = WorktreeTargetInventoryState;

// Owns the Settings pane target view: local/cloud runtime discovery plus
// worktree management actions for each discovered runtime.
export function useWorktreeSettingsTargets() {
  const cloudClient = useProductHost().cloud.client;
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const { data: workspaceCollections } = useWorkspaces();
  const cloudWorkspaces = workspaceCollections?.cloudWorkspaces ?? EMPTY_CLOUD_WORKSPACES;
  const refreshTarget = useWorktreeSettingsTargetCache(runtimeUrl);
  const {
    pruneOrphan: pruneOrphanWorktree,
    pruneWorkspaceCheckout: pruneWorkspaceCheckoutTarget,
    purgeWorkspaceHistory,
    retryWorkspacePurge,
    runRetention: runTargetRetention,
    updateRetentionPolicy,
  } = useWorktreeTargetActions();
  const readyCloudWorkspaces = useMemo(
    () => cloudWorkspaces.filter((workspace) => resolveCloudWorkspaceStatus(workspace) === "ready"),
    [cloudWorkspaces],
  );

  const cloudConnectionQueries = useQueries({
    queries: readyCloudWorkspaces.map((workspace) => ({
      ...cloudWorkspaceConnectionQueryOptions(workspace.id, cloudClient),
      enabled: true,
    })),
  });

  const targets = useMemo(() => {
    const next: WorktreeSettingsTarget[] = [];
    const seen = new Set<string>();
    const trimmedRuntimeUrl = runtimeUrl.trim();
    if (trimmedRuntimeUrl.length > 0) {
      const localTarget = buildLocalWorktreeSettingsTarget(trimmedRuntimeUrl);
      seen.add(localTarget.key);
      next.push(localTarget);
    }

    cloudConnectionQueries.forEach((query, index) => {
      const connection = query.data as CloudConnectionInfo | undefined;
      const workspace = readyCloudWorkspaces[index];
      if (!connection || !workspace || !connection.runtimeUrl) {
        return;
      }
      const generation = typeof connection.runtimeGeneration === "number"
        ? connection.runtimeGeneration
        : null;
      const environmentId = workspace.runtime?.environmentId ?? null;
      const key = worktreeSettingsTargetIdentity(
        "cloud",
        connection.runtimeUrl,
        generation,
        environmentId,
      );
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      next.push({
        key,
        label: environmentId
          ? `Cloud runtime ${environmentId.slice(0, 8)}`
          : workspace.displayName ?? `${workspace.repo.owner}/${workspace.repo.name}`,
        location: "cloud",
        runtimeUrl: connection.runtimeUrl,
        runtimeGeneration: generation,
        environmentId,
        authToken: connection.accessToken,
      });
    });

    return next.length > 0 ? next : EMPTY_TARGETS;
  }, [cloudConnectionQueries, readyCloudWorkspaces, runtimeUrl]);

  const targetStates = useWorktreeTargetInventories(targets);

  const syncPolicyToTarget = useCallback(async (
    target: WorktreeSettingsTarget,
    maxMaterializedWorktreesPerRepo: number,
    options: { runDeferredCleanup?: boolean } = {},
  ) => {
    await updateRetentionPolicy(target, { maxMaterializedWorktreesPerRepo });
    if (options.runDeferredCleanup) {
      await runTargetRetention(target);
    }
    await refreshTarget(target);
  }, [refreshTarget, runTargetRetention, updateRetentionPolicy]);

  const runRetention = useCallback(async (
    target: WorktreeSettingsTarget,
    maxMaterializedWorktreesPerRepo: number,
  ): Promise<RunWorktreeRetentionResponse> => {
    await updateRetentionPolicy(target, { maxMaterializedWorktreesPerRepo });
    const result = await runTargetRetention(target);
    await refreshTarget(target);
    return result;
  }, [refreshTarget, runTargetRetention, updateRetentionPolicy]);

  const pruneOrphan = useCallback(async (
    target: WorktreeSettingsTarget,
    input: PruneOrphanWorktreeRequest,
  ) => {
    await pruneOrphanWorktree(target, input);
    await refreshTarget(target);
  }, [pruneOrphanWorktree, refreshTarget]);

  const pruneWorkspaceCheckout = useCallback(async (
    target: WorktreeSettingsTarget,
    workspaceId: string,
  ): Promise<WorkspaceRetireResponse> => {
    const result = await pruneWorkspaceCheckoutTarget(target, workspaceId);
    await refreshTarget(target);
    return result;
  }, [pruneWorkspaceCheckoutTarget, refreshTarget]);

  const purgeWorkspace = useCallback(async (
    target: WorktreeSettingsTarget,
    workspaceId: string,
  ): Promise<WorkspacePurgeResponse> => {
    const result = await purgeWorkspaceHistory(target, workspaceId);
    await refreshTarget(target);
    return result;
  }, [purgeWorkspaceHistory, refreshTarget]);

  const retryPurge = useCallback(async (
    target: WorktreeSettingsTarget,
    workspaceId: string,
  ): Promise<WorkspacePurgeResponse> => {
    const result = await retryWorkspacePurge(target, workspaceId);
    await refreshTarget(target);
    return result;
  }, [refreshTarget, retryWorkspacePurge]);

  return {
    targets: targetStates,
    isDiscovering: cloudConnectionQueries.some((query) => query.isLoading),
    syncPolicyToTarget,
    runRetention,
    pruneOrphan,
    pruneWorkspaceCheckout,
    purgeWorkspace,
    retryPurge,
  };
}
