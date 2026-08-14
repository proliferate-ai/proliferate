import type {
  PruneOrphanWorktreeRequest,
  WorkspacePurgeResponse,
} from "@anyharness/sdk";
import { useQueries } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { cloudWorkspaceConnectionQueryOptions } from "#product/hooks/access/cloud/use-cloud-workspace-connection";
import { useWorktreeTargetActions } from "#product/hooks/access/anyharness/worktrees/use-worktree-target-actions";
import {
  type WorktreeTargetInventoryState,
  useWorktreeTargetInventories,
} from "#product/hooks/access/anyharness/worktrees/use-worktree-target-inventories";
import { useWorktreeSettingsTargetCache } from "#product/hooks/workspaces/cache/use-worktree-settings-target-cache";
import type { CloudConnectionInfo } from "@proliferate/cloud-sdk/types";
import { useWorkspaces } from "#product/hooks/workspaces/cache/use-workspaces";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { resolveCloudWorkspaceStatus } from "#product/lib/domain/workspaces/cloud/cloud-workspace-status";
import {
  buildLocalWorktreeSettingsTarget,
  type WorktreeSettingsTarget,
  worktreeSettingsTargetIdentity,
} from "#product/lib/domain/workspaces/worktrees/worktree-settings-target";

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
    purgeWorkspaceHistory,
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
          : workspace.displayName
            ?? (workspace.repo ? `${workspace.repo.owner}/${workspace.repo.name}` : "Workspace"),
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
    isDiscovering: cloudConnectionQueries.some((query) => query.isLoading),
    pruneOrphan,
    purgeWorkspace,
  };
}
