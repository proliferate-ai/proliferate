import {
  anyHarnessRuntimeWorkspacesKey,
  anyHarnessWorktreesInventoryKey,
  anyHarnessWorktreesRetentionPolicyKey,
  getAnyHarnessClient,
} from "@anyharness/sdk-react";
import type {
  PruneOrphanWorktreeRequest,
  RunWorktreeRetentionResponse,
  UpdateWorktreeRetentionPolicyRequest,
  WorktreeInventoryResponse,
  WorktreeRetentionPolicy,
  WorkspacePurgeResponse,
  WorkspaceRetireResponse,
} from "@anyharness/sdk";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { getCloudWorkspaceConnection } from "@/lib/integrations/cloud/workspaces";
import type { CloudConnectionInfo } from "@/lib/integrations/cloud/client";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/query-keys";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";

const EMPTY_CLOUD_WORKSPACES: NonNullable<ReturnType<typeof useWorkspaces>["data"]>["cloudWorkspaces"] = [];

export interface WorktreeSettingsTarget {
  key: string;
  label: string;
  location: "local" | "cloud";
  runtimeUrl: string;
  runtimeGeneration: number | null;
  authToken?: string | null;
}

interface WorktreeSettingsTargetData {
  inventory: WorktreeInventoryResponse;
  policy: WorktreeRetentionPolicy;
}

export interface WorktreeSettingsTargetState {
  target: WorktreeSettingsTarget;
  inventory: WorktreeInventoryResponse | null;
  policy: WorktreeRetentionPolicy | null;
  isLoading: boolean;
  error: Error | null;
}

const EMPTY_TARGETS: WorktreeSettingsTarget[] = [];

export function useWorktreeSettingsTargets() {
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const queryClient = useQueryClient();
  const { data: workspaceCollections } = useWorkspaces();
  const cloudWorkspaces = workspaceCollections?.cloudWorkspaces ?? EMPTY_CLOUD_WORKSPACES;
  const readyCloudWorkspaces = useMemo(
    () => cloudWorkspaces.filter((workspace) => workspace.status === "ready"),
    [cloudWorkspaces],
  );

  const cloudConnectionQueries = useQueries({
    queries: readyCloudWorkspaces.map((workspace) => ({
      queryKey: ["worktree-settings", "cloud-connection", workspace.id] as const,
      queryFn: () => getCloudWorkspaceConnection(workspace.id),
      staleTime: Number.POSITIVE_INFINITY,
      retry: 1,
    })),
  });

  const targets = useMemo(() => {
    const next: WorktreeSettingsTarget[] = [];
    const seen = new Set<string>();
    const trimmedRuntimeUrl = runtimeUrl.trim();
    if (trimmedRuntimeUrl.length > 0) {
      const key = targetIdentity("local", trimmedRuntimeUrl, 0);
      seen.add(key);
      next.push({
        key,
        label: "Local runtime",
        location: "local",
        runtimeUrl: trimmedRuntimeUrl,
        runtimeGeneration: 0,
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
      const key = targetIdentity("cloud", connection.runtimeUrl, generation);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      next.push({
        key,
        label: workspace.displayName ?? `${workspace.repo.owner}/${workspace.repo.name}`,
        location: "cloud",
        runtimeUrl: connection.runtimeUrl,
        runtimeGeneration: generation,
        authToken: connection.accessToken,
      });
    });

    return next.length > 0 ? next : EMPTY_TARGETS;
  }, [cloudConnectionQueries, readyCloudWorkspaces, runtimeUrl]);

  const targetDataQueries = useQueries({
    queries: targets.map((target) => ({
      queryKey: targetDataKey(target),
      queryFn: async (): Promise<WorktreeSettingsTargetData> => {
        const client = getAnyHarnessClient({
          runtimeUrl: target.runtimeUrl,
          authToken: target.authToken,
        });
        const [inventory, policy] = await Promise.all([
          client.worktrees.inventory(),
          client.worktrees.retentionPolicy(),
        ]);
        return { inventory, policy };
      },
      enabled: target.runtimeUrl.trim().length > 0,
    })),
  });

  const targetStates = useMemo<WorktreeSettingsTargetState[]>(() => targets.map((target, index) => {
    const query = targetDataQueries[index];
    return {
      target,
      inventory: query?.data?.inventory ?? null,
      policy: query?.data?.policy ?? null,
      isLoading: query?.isLoading ?? false,
      error: query?.error instanceof Error ? query.error : null,
    };
  }), [targetDataQueries, targets]);

  const refreshTarget = async (target: WorktreeSettingsTarget) => {
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
  };

  const clientForTarget = (target: WorktreeSettingsTarget) => getAnyHarnessClient({
    runtimeUrl: target.runtimeUrl,
    authToken: target.authToken,
  });

  return {
    targets: targetStates,
    isDiscovering: cloudConnectionQueries.some((query) => query.isLoading),
    updatePolicy: async (
      target: WorktreeSettingsTarget,
      input: UpdateWorktreeRetentionPolicyRequest,
    ) => {
      await clientForTarget(target).worktrees.updateRetentionPolicy(input);
      await refreshTarget(target);
    },
    runRetention: async (target: WorktreeSettingsTarget): Promise<RunWorktreeRetentionResponse> => {
      const result = await clientForTarget(target).worktrees.runRetention();
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
) {
  return runtimeGeneration === null
    ? `${location}:${runtimeUrl.trim()}`
    : `${location}:${runtimeUrl.trim()}:generation:${runtimeGeneration}`;
}

function targetDataKey(target: WorktreeSettingsTarget) {
  return [
    "worktree-settings",
    "target",
    target.location,
    target.runtimeUrl,
    target.runtimeGeneration,
  ] as const;
}
