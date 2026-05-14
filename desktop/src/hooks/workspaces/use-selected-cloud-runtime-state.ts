import { useMutation } from "@tanstack/react-query";
import type {
  CloudConnectionInfo,
  CloudWorkspaceStatus,
} from "@/lib/access/cloud/client";
import { useMemo } from "react";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import {
  buildSelectedCloudRuntimeViewModel,
  type SelectedCloudRuntimeViewModel,
} from "@/lib/domain/workspaces/cloud/cloud-runtime-state";
import { useCloudWorkspaceConnectionCache } from "@/hooks/access/cloud/use-cloud-workspace-connection-cache";
import { useCloudWorkspaceConnection } from "@/hooks/access/cloud/use-cloud-workspace-connection";
import { startCloudWorkspace as startCloudWorkspaceRequest } from "@proliferate/cloud-sdk/client/workspaces";
import { useWorkspaceSelectionCache } from "@/hooks/workspaces/cache/use-workspace-selection-cache";
import { captureTelemetryException, trackProductEvent } from "@/lib/integrations/telemetry/client";
import { hasWorkspaceBootstrappedInSession } from "@/hooks/workspaces/lifecycle/workspace-bootstrap-memory";
import { useIsHotPaintGatePendingForWorkspace } from "@/hooks/workspaces/derived/use-hot-paint-gate";

export interface SelectedCloudRuntimeState {
  workspaceId: string | null;
  cloudWorkspaceId: string | null;
  state: SelectedCloudRuntimeViewModel | null;
  connectionInfo: CloudConnectionInfo | null;
  retry: (() => void) | null;
}

export function useSelectedCloudRuntimeState(): SelectedCloudRuntimeState {
  const {
    clearCachedCloudWorkspaceConnections,
  } = useCloudWorkspaceConnectionCache();
  const {
    invalidateCloudWorkspaceStartState,
  } = useWorkspaceSelectionCache();
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const hotPaintPending = useIsHotPaintGatePendingForWorkspace(selectedWorkspaceId);
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const { data: workspaceCollections } = useWorkspaces();

  const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(selectedWorkspaceId);
  const selectedCloudWorkspace = workspaceCollections?.cloudWorkspaces.find(
    (workspace) => workspace.id === cloudWorkspaceId,
  ) ?? null;
  const startMutation = useMutation({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async (workspaceId: string) => startCloudWorkspaceRequest(workspaceId),
    onSuccess: async (workspace) => {
      await clearCachedCloudWorkspaceConnections(workspace.id);
      await invalidateCloudWorkspaceStartState(runtimeUrl);
      trackProductEvent("cloud_workspace_started", {
        workspace_kind: "cloud",
        status: workspace.status,
        git_provider: workspace.repo.provider,
      });
    },
    onError: (error) => {
      captureTelemetryException(error, {
        tags: {
          action: "start_selected_cloud_runtime",
          domain: "cloud_workspace",
          workspace_kind: "cloud",
        },
      });
    },
  });
  const persistedStatus = (selectedCloudWorkspace?.status ?? null) as CloudWorkspaceStatus | null;
  const isWarm = selectedWorkspaceId !== null && hasWorkspaceBootstrappedInSession(selectedWorkspaceId);
  const connectionQuery = useCloudWorkspaceConnection(
    selectedCloudWorkspace?.id ?? null,
    persistedStatus === "ready" && !hotPaintPending,
  );

  const connectionState = useMemo(() => {
    if (persistedStatus !== "ready") {
      return "resolving" as const;
    }
    if (connectionQuery.fetchStatus !== "idle" || connectionQuery.status === "pending") {
      return "resolving" as const;
    }
    if (connectionQuery.status === "error") {
      return "failed" as const;
    }
    if (connectionQuery.data) {
      return "ready" as const;
    }
    return "failed" as const;
  }, [
    connectionQuery.data,
    connectionQuery.fetchStatus,
    connectionQuery.status,
    persistedStatus,
  ]);

  const state = useMemo(() => buildSelectedCloudRuntimeViewModel({
    persistedStatus,
    connectionState,
    credentialFreshness: connectionQuery.data?.credentialFreshness
      ?? selectedCloudWorkspace?.runtime?.credentialFreshness
      ?? null,
    isWarm,
  }), [
    connectionState,
    connectionQuery.data?.credentialFreshness,
    isWarm,
    persistedStatus,
    selectedCloudWorkspace?.runtime?.credentialFreshness,
  ]);

  return {
    workspaceId: selectedWorkspaceId,
    cloudWorkspaceId,
    state,
    connectionInfo: persistedStatus === "ready" ? connectionQuery.data ?? null : null,
    retry: persistedStatus === "ready"
      ? () => {
        if (
          connectionState === "failed"
          && selectedCloudWorkspace?.id
          && !startMutation.isPending
        ) {
          void startMutation
            .mutateAsync(selectedCloudWorkspace.id)
            .then(() => connectionQuery.refetch())
            .catch(() => undefined);
          return;
        }
        void connectionQuery.refetch();
      }
      : null,
  };
}
