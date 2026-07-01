import { useMutation } from "@tanstack/react-query";
import type {
  CloudWorkspaceDetail,
} from "@/lib/access/cloud/client";
import {
  archiveCloudWorkspace,
  deleteCloudWorkspace,
  getCloudWorkspace,
  restoreCloudWorkspace,
} from "@proliferate/cloud-sdk/client/workspaces";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { useCloudWorkspaceLifecycleCache } from "@/hooks/access/cloud/use-cloud-workspace-lifecycle-cache";
import { useCloudWorkspaceConnectionCache } from "@/hooks/access/cloud/use-cloud-workspace-connection-cache";
import { useInvalidateCloudBillingState } from "@/hooks/access/cloud/use-cloud-billing";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { getWorkspaceSessionRecords } from "@/stores/sessions/session-records";
import { useWorkspaceSelection } from "@/hooks/workspaces/workflows/selection/use-workspace-selection";
import { useWorkspaceCollectionsInvalidation } from "@/hooks/workspaces/cache/use-workspace-collections-invalidation";
import { useWorkspaceCollectionsMutationCache } from "@/hooks/workspaces/cache/use-workspace-collections-mutation-cache";
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
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const { clearWorkspaceRuntimeState } = useWorkspaceSelection();
  const invalidateCloudBillingState = useInvalidateCloudBillingState();
  const invalidateWorkspaceCollections = useWorkspaceCollectionsInvalidation(runtimeUrl);
  const { upsertCloudWorkspace } = useWorkspaceCollectionsMutationCache(runtimeUrl);
  const { invalidateCloudWorkspaceLifecycle } = useCloudWorkspaceLifecycleCache();
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
      invalidateCloudWorkspaceLifecycle(workspace.id);
      await invalidateWorkspaceCollections();
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
      invalidateCloudWorkspaceLifecycle(workspace.id);
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

  return {
    refreshCloudWorkspace: refreshMutation.mutateAsync,
    isRefreshingCloudWorkspace: refreshMutation.isPending,
    archiveCloudWorkspace: archiveMutation.mutateAsync,
    isArchivingCloudWorkspace: archiveMutation.isPending,
    restoreCloudWorkspace: restoreMutation.mutateAsync,
    isRestoringCloudWorkspace: restoreMutation.isPending,
    deleteCloudWorkspace: deleteMutation.mutateAsync,
    isDeletingCloudWorkspace: deleteMutation.isPending,
  };
}
