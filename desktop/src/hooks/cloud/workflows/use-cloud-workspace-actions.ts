import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CloudWorkspaceDetail,
} from "@/lib/access/cloud/client";
import {
  archiveCloudWorkspace,
  deleteCloudWorkspace,
  getCloudWorkspace,
  restoreCloudWorkspace,
  startCloudWorkspace,
  updateCloudWorkspaceBranch,
} from "@proliferate/cloud-sdk/client/workspaces";
import { invalidateCloudWorkspaceLifecycleQueries } from "@proliferate/cloud-sdk-react/hooks/workspaces";
import { autoSyncDetectedAgentAuthCredentialsIfNeeded } from "@/lib/access/cloud/agent-auth-recovery";
import { syncLocalAgentAuthCredentialToCloud } from "@/lib/access/cloud/agent-auth-sync";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { useCloudWorkspaceConnectionCache } from "@/hooks/access/cloud/use-cloud-workspace-connection-cache";
import { useInvalidateCloudBillingState } from "@/hooks/access/cloud/use-cloud-billing";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { getWorkspaceSessionRecords } from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import { useWorkspaceCollectionsInvalidation } from "@/hooks/workspaces/cache/use-workspace-collections-invalidation";
import { useWorkspaceCollectionsMutationCache } from "@/hooks/workspaces/cache/use-workspace-collections-mutation-cache";
import {
  resolveActiveProjectedSessionForPendingWorkspace,
} from "@/hooks/workspaces/workflows/pending-workspace-projected-session";
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
  const invalidateCloudBillingState = useInvalidateCloudBillingState();
  const invalidateWorkspaceCollections = useWorkspaceCollectionsInvalidation(runtimeUrl);
  const { upsertCloudWorkspace } = useWorkspaceCollectionsMutationCache(runtimeUrl);
  const { clearCachedCloudWorkspaceConnections } = useCloudWorkspaceConnectionCache();
  const clearDeferredLaunchesForWorkspace = useDeferredHomeLaunchStore((state) =>
    state.clearForWorkspace
  );

  async function invalidateCloudResources() {
    await invalidateCloudBillingState();
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
      upsertCloudWorkspace(workspace);
      invalidateCloudWorkspaceLifecycleQueries(queryClient, workspace.id);
      await invalidateWorkspaceCollections();
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
        const didSync = await autoSyncDetectedAgentAuthCredentialsIfNeeded(
          error,
          syncLocalAgentAuthCredentialToCloud,
        );
        if (!didSync) {
          throw error;
        }
        return await startCloudWorkspace(cloudWorkspaceId);
      }
    },
    onSuccess: async (workspace) => {
      await clearCachedCloudWorkspaceConnections(workspace.id);
      upsertCloudWorkspace(workspace);
      await invalidateCloudResources();
      const syntheticWorkspaceId = cloudWorkspaceSyntheticId(workspace.id);
      const pendingWorkspaceEntry = useSessionSelectionStore.getState().pendingWorkspaceEntry;
      const shouldPreservePending = pendingWorkspaceEntry?.workspaceId === syntheticWorkspaceId
        && pendingWorkspaceEntry.stage === "awaiting-cloud-ready";
      const initialActiveSessionId = shouldPreservePending
        ? resolveActiveProjectedSessionForPendingWorkspace(syntheticWorkspaceId, pendingWorkspaceEntry)
        : null;
      if (selectedWorkspaceId === syntheticWorkspaceId) {
        await selectWorkspace(syntheticWorkspaceId, {
          force: true,
          preservePending: shouldPreservePending,
          ...(initialActiveSessionId ? { initialActiveSessionId } : {}),
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
      await clearCachedCloudWorkspaceConnections(cloudWorkspaceId);
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

  const archiveMutation = useMutation<CloudWorkspaceDetail, Error, string>({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async (workspaceId) => {
      const cloudWorkspaceId = workspaceId.startsWith("cloud:")
        ? workspaceId.slice("cloud:".length)
        : workspaceId;
      const workspace = await archiveCloudWorkspace(cloudWorkspaceId);
      await clearCachedCloudWorkspaceConnections(cloudWorkspaceId);
      return workspace;
    },
    onSuccess: async (workspace) => {
      upsertCloudWorkspace(workspace);
      invalidateCloudWorkspaceLifecycleQueries(queryClient, workspace.id);
      await invalidateWorkspaceCollections();
    },
    onError: (error) => {
      captureTelemetryException(error, {
        tags: {
          action: "archive_cloud_workspace",
          domain: "cloud_workspace",
          workspace_kind: "cloud",
        },
      });
    },
  });

  const restoreMutation = useMutation<CloudWorkspaceDetail, Error, string>({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async (workspaceId) => {
      const cloudWorkspaceId = workspaceId.startsWith("cloud:")
        ? workspaceId.slice("cloud:".length)
        : workspaceId;
      return restoreCloudWorkspace(cloudWorkspaceId);
    },
    onSuccess: async (workspace) => {
      upsertCloudWorkspace(workspace);
      await invalidateWorkspaceCollections();
    },
    onError: (error) => {
      captureTelemetryException(error, {
        tags: {
          action: "restore_cloud_workspace",
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
      upsertCloudWorkspace(workspace);
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
    archiveCloudWorkspace: archiveMutation.mutateAsync,
    isArchivingCloudWorkspace: archiveMutation.isPending,
    restoreCloudWorkspace: restoreMutation.mutateAsync,
    isRestoringCloudWorkspace: restoreMutation.isPending,
    deleteCloudWorkspace: deleteMutation.mutateAsync,
    isDeletingCloudWorkspace: deleteMutation.isPending,
  };
}
