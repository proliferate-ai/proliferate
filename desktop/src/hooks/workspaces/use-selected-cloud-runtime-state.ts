import type { CloudConnectionInfo, CloudWorkspaceStatus } from "@/lib/integrations/cloud/client";
import { useMemo } from "react";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import {
  buildSelectedCloudRuntimeViewModel,
  type SelectedCloudRuntimeViewModel,
} from "@/lib/domain/workspaces/cloud-runtime-state";
import { useCloudWorkspaceConnection } from "@/hooks/cloud/use-cloud-workspace-connection";
import { useCloudWorkspaceActions } from "@/hooks/cloud/use-cloud-workspace-actions";
import { hasWorkspaceBootstrappedInSession } from "./workspace-bootstrap-memory";

export interface SelectedCloudRuntimeState {
  workspaceId: string | null;
  cloudWorkspaceId: string | null;
  state: SelectedCloudRuntimeViewModel | null;
  connectionInfo: CloudConnectionInfo | null;
  retry: (() => void) | null;
}

export function useSelectedCloudRuntimeState(): SelectedCloudRuntimeState {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const { data: workspaceCollections } = useWorkspaces();

  const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(selectedWorkspaceId);
  const { isStartingCloudWorkspace, startCloudWorkspace } = useCloudWorkspaceActions();
  const selectedCloudWorkspace = workspaceCollections?.cloudWorkspaces.find(
    (workspace) => workspace.id === cloudWorkspaceId,
  ) ?? null;
  const persistedStatus = (selectedCloudWorkspace?.status ?? null) as CloudWorkspaceStatus | null;
  const isWarm = selectedWorkspaceId !== null && hasWorkspaceBootstrappedInSession(selectedWorkspaceId);
  const connectionQuery = useCloudWorkspaceConnection(
    selectedCloudWorkspace?.id ?? null,
    persistedStatus === "ready",
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
    isWarm,
  }), [
    connectionState,
    isWarm,
    persistedStatus,
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
          && !isStartingCloudWorkspace
        ) {
          void startCloudWorkspace(selectedCloudWorkspace.id);
          return;
        }
        void connectionQuery.refetch();
      }
      : null,
  };
}
