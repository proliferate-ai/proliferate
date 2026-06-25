import type {
  CloudConnectionInfo,
  CloudWorkspaceStatus,
} from "@/lib/access/cloud/client";
import type { TerminalWebSocketAuthTransport } from "@anyharness/sdk";
import { useMemo } from "react";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import {
  buildSelectedCloudRuntimeViewModel,
  type SelectedCloudRuntimeViewModel,
} from "@/lib/domain/workspaces/cloud/cloud-runtime-state";
import { cloudWorkspaceUsesCloudRuntime } from "@/lib/domain/workspaces/cloud/cloud-runtime-kind";
import { resolveCloudWorkspaceStatus } from "@/lib/domain/workspaces/cloud/cloud-workspace-status";
import { useCloudWorkspaceConnection } from "@/hooks/access/cloud/use-cloud-workspace-connection";
import { useSelectedCloudRuntimeActions } from "@/hooks/workspaces/workflows/use-selected-cloud-runtime-actions";
import { hasWorkspaceBootstrappedInSession } from "@/hooks/workspaces/lifecycle/workspace-bootstrap-memory";

export interface SelectedCloudRuntimeState {
  workspaceId: string | null;
  cloudWorkspaceId: string | null;
  state: SelectedCloudRuntimeViewModel | null;
  connectionInfo: (CloudConnectionInfo & {
    webSocketAuthTransport?: TerminalWebSocketAuthTransport;
  }) | null;
  retry: (() => void) | null;
  claim: (() => void) | null;
  claimPending: boolean;
}

export function useSelectedCloudRuntimeState(): SelectedCloudRuntimeState {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const { data: workspaceCollections } = useWorkspaces();

  const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(selectedWorkspaceId);
  const selectedCloudWorkspace = workspaceCollections?.cloudWorkspaces.find(
    (workspace) => workspace.id === cloudWorkspaceId,
  ) ?? null;
  const persistedStatus = resolveCloudWorkspaceStatus(selectedCloudWorkspace) as CloudWorkspaceStatus | null;
  const usesCloudRuntime = cloudWorkspaceUsesCloudRuntime(selectedCloudWorkspace);
  const usesDirectAttach = selectedCloudWorkspace ? !usesCloudRuntime : false;
  const needsClaim = selectedCloudWorkspace?.visibility === "shared_unclaimed";
  const isWarm = selectedWorkspaceId !== null && hasWorkspaceBootstrappedInSession(selectedWorkspaceId);
  const connectionQueryEnabled = persistedStatus === "ready" && !usesDirectAttach && !needsClaim;
  const connectionQuery = useCloudWorkspaceConnection(
    selectedCloudWorkspace?.id ?? null,
    connectionQueryEnabled,
  );

  const connectionState = useMemo(() => {
    if (persistedStatus !== "ready") {
      return "resolving" as const;
    }
    if (usesDirectAttach) {
      return "ready" as const;
    }
    if (connectionQuery.data) {
      return "ready" as const;
    }
    if (!connectionQueryEnabled) {
      return "failed" as const;
    }
    if (connectionQuery.fetchStatus !== "idle" || connectionQuery.status === "pending") {
      return "resolving" as const;
    }
    if (connectionQuery.status === "error") {
      return "failed" as const;
    }
    return "failed" as const;
  }, [
    connectionQuery.data,
    connectionQuery.fetchStatus,
    connectionQuery.status,
    connectionQueryEnabled,
    persistedStatus,
    usesDirectAttach,
  ]);
  const canUseConnection = persistedStatus === "ready" && !usesDirectAttach && !needsClaim;
  const runtimeActions = useSelectedCloudRuntimeActions({
    cloudWorkspaceId: selectedCloudWorkspace?.id ?? null,
    canUseConnection,
    connectionFailed: connectionState === "failed",
    needsClaim,
    refetchConnection: connectionQuery.refetch,
  });

  const state = useMemo(() => buildSelectedCloudRuntimeViewModel({
    persistedStatus,
    visibility: selectedCloudWorkspace?.visibility ?? null,
    connectionState,
    runtimeAuth: usesCloudRuntime
      ? connectionQuery.data?.runtimeAuth
        ?? selectedCloudWorkspace?.runtime?.runtimeAuth
        ?? null
      : null,
    isWarm,
  }), [
    connectionState,
    connectionQuery.data?.runtimeAuth,
    isWarm,
    persistedStatus,
    selectedCloudWorkspace?.runtime?.runtimeAuth,
    selectedCloudWorkspace?.visibility,
    usesCloudRuntime,
  ]);

  return {
    workspaceId: selectedWorkspaceId,
    cloudWorkspaceId,
    state,
    connectionInfo: canUseConnection
      ? connectionQuery.data ?? null
      : null,
    retry: runtimeActions.retry,
    claim: runtimeActions.claim,
    claimPending: runtimeActions.claimPending,
  };
}
