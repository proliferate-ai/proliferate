import {
  anyHarnessRuntimeWorkspacesKey,
  anyHarnessWorktreesInventoryKey,
  anyHarnessWorktreesRetentionPolicyKey,
  getAnyHarnessClient,
} from "@anyharness/sdk-react";
import type {
  PruneOrphanWorktreeRequest,
  RunWorktreeRetentionResponse,
  WorktreeInventoryResponse,
  WorkspacePurgeResponse,
  WorkspaceRetireResponse,
} from "@anyharness/sdk";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { cloudWorkspaceConnectionQueryOptions } from "@/hooks/cloud/use-cloud-workspace-connection";
import type { CloudConnectionInfo } from "@/lib/access/cloud/client";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/query-keys";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

const EMPTY_CLOUD_WORKSPACES: NonNullable<ReturnType<typeof useWorkspaces>["data"]>["cloudWorkspaces"] = [];

export interface WorktreeSettingsTarget {
  key: string;
  label: string;
  location: "local" | "cloud";
  runtimeUrl: string;
  runtimeGeneration: number | null;
  environmentId: string | null;
  authToken?: string | null;
}

export interface WorktreeSettingsTargetState {
  target: WorktreeSettingsTarget;
  inventory: WorktreeInventoryResponse | null;
  isLoading: boolean;
  error: Error | null;
}

const EMPTY_TARGETS: WorktreeSettingsTarget[] = [];

export function useWorktreeSettingsTargets() {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const queryClient = useQueryClient();
  const { data: workspaceCollections } = useWorkspaces();
  const cloudWorkspaces = workspaceCollections?.cloudWorkspaces ?? EMPTY_CLOUD_WORKSPACES;
  const readyCloudWorkspaces = useMemo(
    () => cloudWorkspaces.filter((workspace) => workspace.status === "ready"),
    [cloudWorkspaces],
  );

  const cloudConnectionQueries = useQueries({
    queries: readyCloudWorkspaces.map((workspace) => ({
      ...cloudWorkspaceConnectionQueryOptions(workspace.id),
      enabled: true,
    })),
  });

  const targets = useMemo(() => {
    const next: WorktreeSettingsTarget[] = [];
    const seen = new Set<string>();
    const trimmedRuntimeUrl = runtimeUrl.trim();
    if (trimmedRuntimeUrl.length > 0) {
      const key = targetIdentity("local", trimmedRuntimeUrl, 0, null);
      seen.add(key);
      next.push({
        key,
        label: "Local runtime",
        location: "local",
        runtimeUrl: trimmedRuntimeUrl,
        runtimeGeneration: 0,
        environmentId: null,
      });
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
      const key = targetIdentity("cloud", connection.runtimeUrl, generation, environmentId);
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

  const targetDataQueries = useQueries({
    queries: targets.map((target) => ({
      queryKey: targetDataKey(target),
      queryFn: async ({ signal }): Promise<WorktreeInventoryResponse> => {
        const client = getAnyHarnessClient({
          runtimeUrl: target.runtimeUrl,
          authToken: target.authToken,
        });
        return client.worktrees.inventory({ signal });
      },
      enabled: target.runtimeUrl.trim().length > 0,
    })),
  });

  const targetStates = useMemo<WorktreeSettingsTargetState[]>(() => targets.map((target, index) => {
    const query = targetDataQueries[index];
    return {
      target,
      inventory: query?.data ?? null,
      isLoading: query?.isLoading ?? false,
      error: query?.error instanceof Error ? query.error : null,
    };
  }), [targetDataQueries, targets]);

  const refreshTarget = useCallback(async (target: WorktreeSettingsTarget) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: targetDataKey(target) }),
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
        queryKey: workspaceCollectionsScopeKey(runtimeUrl),
      }),
    ]);
  }, [queryClient, runtimeUrl]);

  const clientForTarget = useCallback((target: WorktreeSettingsTarget) => getAnyHarnessClient({
    runtimeUrl: target.runtimeUrl,
    authToken: target.authToken,
  }), []);

  const syncPolicyToTarget = useCallback(async (
    target: WorktreeSettingsTarget,
    maxMaterializedWorktreesPerRepo: number,
    options: { runDeferredCleanup?: boolean } = {},
  ) => {
    const client = clientForTarget(target);
    await client.worktrees.updateRetentionPolicy({ maxMaterializedWorktreesPerRepo });
    if (options.runDeferredCleanup) {
      await client.worktrees.runRetention();
    }
    await refreshTarget(target);
  }, [clientForTarget, refreshTarget]);

  return {
    targets: targetStates,
    isDiscovering: cloudConnectionQueries.some((query) => query.isLoading),
    syncPolicyToTarget,
    runRetention: async (
      target: WorktreeSettingsTarget,
      maxMaterializedWorktreesPerRepo: number,
    ): Promise<RunWorktreeRetentionResponse> => {
      const client = clientForTarget(target);
      await client.worktrees.updateRetentionPolicy({ maxMaterializedWorktreesPerRepo });
      const result = await client.worktrees.runRetention();
      await refreshTarget(target);
      return result;
    },
    pruneOrphan: async (target: WorktreeSettingsTarget, input: PruneOrphanWorktreeRequest) => {
      await clientForTarget(target).worktrees.pruneOrphan(input);
      await refreshTarget(target);
    },
    pruneWorkspaceCheckout: async (
      target: WorktreeSettingsTarget,
      workspaceId: string,
    ): Promise<WorkspaceRetireResponse> => {
      const result = await clientForTarget(target).workspaces.retire(workspaceId);
      await refreshTarget(target);
      return result;
    },
    purgeWorkspace: async (
      target: WorktreeSettingsTarget,
      workspaceId: string,
    ): Promise<WorkspacePurgeResponse> => {
      const result = await clientForTarget(target).workspaces.purge(workspaceId);
      await refreshTarget(target);
      return result;
    },
    retryPurge: async (
      target: WorktreeSettingsTarget,
      workspaceId: string,
    ): Promise<WorkspacePurgeResponse> => {
      const result = await clientForTarget(target).workspaces.retryPurge(workspaceId);
      await refreshTarget(target);
      return result;
    },
  };
}

function targetIdentity(
  location: "local" | "cloud",
  runtimeUrl: string,
  runtimeGeneration: number | null,
  environmentId: string | null,
) {
  const runtimeIdentity = environmentId ?? runtimeUrl.trim();
  return runtimeGeneration === null
    ? `${location}:${runtimeIdentity}`
    : `${location}:${runtimeIdentity}:generation:${runtimeGeneration}`;
}

function targetDataKey(target: WorktreeSettingsTarget) {
  return [
    "worktree-settings",
    "target",
    target.location,
    target.environmentId ?? target.runtimeUrl,
    target.runtimeGeneration,
  ] as const;
}
