import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CloudWorkspaceDetail,
} from "@/lib/access/cloud/client";
import {
  deleteCloudWorkspace,
  getCloudWorkspace,
  startCloudWorkspace,
  updateCloudWorkspaceBranch,
} from "@/lib/access/cloud/workspaces";
import {
  type WorkspaceCollections,
  upsertCloudWorkspaceCollections,
} from "@/lib/domain/workspaces/cloud/collections";
import { autoSyncDetectedCloudCredentialsIfNeeded } from "./cloud-credential-recovery";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { clearCachedCloudConnections } from "@/hooks/access/cloud/cloud-connection-cache";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { getWorkspaceSessionRecords } from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import { cloudBillingKey } from "@/hooks/access/cloud/query-keys";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/query-keys";
import { useCloudCredentialActions } from "./use-cloud-credential-actions";
import { clearViewedSessionErrors } from "@/stores/preferences/workspace-ui-store";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import { useDeferredHomeLaunchStore } from "@/stores/home/deferred-home-launch-store";

interface DeleteCloudWorkspaceContext {
  viewedSessionErrorIdsToClear: string[];
}

const EMPTY_SESSION_IDS: string[] = [];

function resolveCloudWorkspaceRuntimeId(workspaceId: string): string {
  return workspaceId.startsWith("cloud:")
    ? workspaceId
    : cloudWorkspaceSyntheticId(workspaceId);
}

export function useCloudWorkspaceActions() {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const { selectWorkspace, clearWorkspaceRuntimeState } = useWorkspaceSelection();
  const { syncCloudCredential } = useCloudCredentialActions();
  const clearDeferredLaunchesForWorkspace = useDeferredHomeLaunchStore((state) =>
    state.clearForWorkspace
  );

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

  function primeCloudWorkspace(workspace: CloudWorkspaceDetail) {
    queryClient.setQueriesData<WorkspaceCollections | undefined>(
      { queryKey: workspaceCollectionsScopeKey(runtimeUrl) },
      (collections) => upsertCloudWorkspaceCollections(collections, workspace),
    );
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
    onSuccess: async (workspace) => {
      primeCloudWorkspace(workspace);
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
      await clearCachedCloudConnections(queryClient, workspace.id);
      primeCloudWorkspace(workspace);
      await invalidateCloudResources();
      const syntheticWorkspaceId = cloudWorkspaceSyntheticId(workspace.id);
      const pendingWorkspaceEntry = useSessionSelectionStore.getState().pendingWorkspaceEntry;
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

  const deleteMutation = useMutation<void, Error, string, DeleteCloudWorkspaceContext>({
    meta: {
      telemetryHandled: true,
    },
    onMutate: (workspaceId) => {
      const runtimeWorkspaceId = resolveCloudWorkspaceRuntimeId(workspaceId);
      return {
        viewedSessionErrorIdsToClear: Object.values(getWorkspaceSessionRecords(runtimeWorkspaceId))
          .map((slot) => slot.sessionId),
      };
    },
    mutationFn: async (workspaceId) => {
      const cloudWorkspaceId = workspaceId.startsWith("cloud:")
        ? workspaceId.slice("cloud:".length)
        : workspaceId;
      await deleteCloudWorkspace(cloudWorkspaceId);
      await clearCachedCloudConnections(queryClient, cloudWorkspaceId);
    },
    onSuccess: async (_, workspaceId, context) => {
      const runtimeWorkspaceId = resolveCloudWorkspaceRuntimeId(workspaceId);
      clearViewedSessionErrors(context?.viewedSessionErrorIdsToClear ?? EMPTY_SESSION_IDS);
      clearWorkspaceRuntimeState(runtimeWorkspaceId, {
        clearSelection: true,
        clearDraftUiKey: workspaceId,
      });
      clearDeferredLaunchesForWorkspace(runtimeWorkspaceId);
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
    onSuccess: async (workspace) => {
      primeCloudWorkspace(workspace);
      await invalidateCloudResources();
    },
  });

  return {
    refreshCloudWorkspace: refreshMutation.mutateAsync,
    isRefreshingCloudWorkspace: refreshMutation.isPending,
    startCloudWorkspace: startMutation.mutateAsync,
    isStartingCloudWorkspace: startMutation.isPending,
    syncCloudWorkspaceBranch: syncBranchMutation.mutateAsync,
    isSyncingCloudWorkspaceBranch: syncBranchMutation.isPending,
    deleteCloudWorkspace: deleteMutation.mutateAsync,
    isDeletingCloudWorkspace: deleteMutation.isPending,
  };
}
