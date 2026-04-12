import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CloudWorkspaceDetail,
} from "@/lib/integrations/cloud/client";
import {
  deleteCloudWorkspace,
  getCloudWorkspace,
  startCloudWorkspace,
  stopCloudWorkspace,
  updateCloudWorkspaceBranch,
} from "@/lib/integrations/cloud/workspaces";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import { clearCachedCloudConnections } from "@/lib/integrations/anyharness/runtime-target";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import { cloudBillingKey } from "./query-keys";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/query-keys";
import { useCloudCredentialActions } from "./use-cloud-credential-actions";
import { autoSyncDetectedCloudCredentialsIfNeeded } from "./auto-sync-detected-cloud-credentials";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";

export function useCloudWorkspaceActions() {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const { selectWorkspace, clearWorkspaceRuntimeState } = useWorkspaceSelection();
  const { syncCloudCredential } = useCloudCredentialActions();

  async function invalidateCloudResources() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: workspaceCollectionsScopeKey(runtimeUrl),
      }),
      queryClient.invalidateQueries({
        queryKey: cloudBillingKey(),
      }),
    ]);
  }

  const refreshMutation = useMutation<CloudWorkspaceDetail, Error, string>({
    mutationFn: async (workspaceId) => {
      const cloudWorkspaceId = workspaceId.startsWith("cloud:")
        ? workspaceId.slice("cloud:".length)
        : workspaceId;
      const workspace = await getCloudWorkspace(cloudWorkspaceId);
      if (!workspace) throw new Error("Cloud workspace not found.");
      return workspace;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: workspaceCollectionsScopeKey(runtimeUrl),
      });
    },
  });

  const startMutation = useMutation<CloudWorkspaceDetail, Error, string>({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async (workspaceId) => {
      const cloudWorkspaceId = workspaceId.startsWith("cloud:")
        ? workspaceId.slice("cloud:".length)
        : workspaceId;
      try {
        return await startCloudWorkspace(cloudWorkspaceId);
      } catch (error) {
        const didSync = await autoSyncDetectedCloudCredentialsIfNeeded(
          error,
          syncCloudCredential,
        );
        if (!didSync) {
          throw error;
        }
        return await startCloudWorkspace(cloudWorkspaceId);
      }
    },
    onSuccess: async (workspace) => {
      await clearCachedCloudConnections(workspace.id);
      await invalidateCloudResources();
      const syntheticWorkspaceId = cloudWorkspaceSyntheticId(workspace.id);
      const pendingWorkspaceEntry = useHarnessStore.getState().pendingWorkspaceEntry;
      const shouldPreservePending = pendingWorkspaceEntry?.workspaceId === syntheticWorkspaceId
        && pendingWorkspaceEntry.stage === "awaiting-cloud-ready";
      if (selectedWorkspaceId === syntheticWorkspaceId) {
        await selectWorkspace(syntheticWorkspaceId, {
          force: true,
          preservePending: shouldPreservePending,
        });
      }
      trackProductEvent("cloud_workspace_started", {
        workspace_kind: "cloud",
        status: workspace.status,
        git_provider: workspace.repo.provider,
      });
    },
    onError: (error) => {
      captureTelemetryException(error, {
        tags: {
          action: "start_cloud_workspace",
          domain: "cloud_workspace",
          workspace_kind: "cloud",
        },
      });
    },
  });

  const stopMutation = useMutation<CloudWorkspaceDetail, Error, string>({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async (workspaceId) => {
      const cloudWorkspaceId = workspaceId.startsWith("cloud:")
        ? workspaceId.slice("cloud:".length)
        : workspaceId;
      return await stopCloudWorkspace(cloudWorkspaceId);
    },
    onSuccess: async (workspace) => {
      await clearCachedCloudConnections(workspace.id);
      clearWorkspaceRuntimeState(cloudWorkspaceSyntheticId(workspace.id));
      await invalidateCloudResources();
      trackProductEvent("cloud_workspace_stopped", {
        workspace_kind: "cloud",
        status: workspace.status,
        git_provider: workspace.repo.provider,
      });
    },
    onError: (error) => {
      captureTelemetryException(error, {
        tags: {
          action: "stop_cloud_workspace",
          domain: "cloud_workspace",
          workspace_kind: "cloud",
        },
      });
    },
  });

  const deleteMutation = useMutation<void, Error, string>({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async (workspaceId) => {
      const cloudWorkspaceId = workspaceId.startsWith("cloud:")
        ? workspaceId.slice("cloud:".length)
        : workspaceId;
      await deleteCloudWorkspace(cloudWorkspaceId);
      await clearCachedCloudConnections(cloudWorkspaceId);
    },
    onSuccess: async (_, workspaceId) => {
      clearWorkspaceRuntimeState(workspaceId, { clearSelection: true });
      await invalidateCloudResources();
      trackProductEvent("cloud_workspace_deleted", {
        workspace_kind: "cloud",
      });
    },
    onError: (error) => {
      captureTelemetryException(error, {
        tags: {
          action: "delete_cloud_workspace",
          domain: "cloud_workspace",
          workspace_kind: "cloud",
        },
      });
    },
  });

  const syncBranchMutation = useMutation<CloudWorkspaceDetail, Error, {
    workspaceId: string;
    branchName: string;
  }>({
    mutationFn: async ({ workspaceId, branchName }) => {
      const cloudWorkspaceId = workspaceId.startsWith("cloud:")
        ? workspaceId.slice("cloud:".length)
        : workspaceId;
      return updateCloudWorkspaceBranch(cloudWorkspaceId, branchName);
    },
    onSuccess: async () => {
      await invalidateCloudResources();
    },
  });

  return {
    refreshCloudWorkspace: refreshMutation.mutateAsync,
    isRefreshingCloudWorkspace: refreshMutation.isPending,
    startCloudWorkspace: startMutation.mutateAsync,
    isStartingCloudWorkspace: startMutation.isPending,
    stopCloudWorkspace: stopMutation.mutateAsync,
    isStoppingCloudWorkspace: stopMutation.isPending,
    syncCloudWorkspaceBranch: syncBranchMutation.mutateAsync,
    isSyncingCloudWorkspaceBranch: syncBranchMutation.isPending,
    deleteCloudWorkspace: deleteMutation.mutateAsync,
    isDeletingCloudWorkspace: deleteMutation.isPending,
  };
}
