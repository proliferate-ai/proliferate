import { useHarnessStore } from "@/stores/sessions/harness-store";
import { findLogicalWorkspace, resolveLogicalWorkspaceMaterializationId } from "@/lib/domain/workspaces/logical-workspaces";
import {
  markWorkspaceViewed,
  trackWorkspaceInteraction,
  useWorkspaceUiStore,
} from "@/stores/preferences/workspace-ui-store";
import { getLatestWorkspaceInteractionTimestamp } from "@/lib/domain/workspaces/selection";
import {
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/debug-latency";
import { cancelLatencyFlow } from "@/lib/infra/latency-flow";
import { cloudBillingKey } from "@/hooks/cloud/query-keys";
import { isCloudWorkspaceNotReadyError } from "@/hooks/cloud/use-cloud-workspace-connection";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/query-keys";
import { startCloudWorkspace } from "@/lib/integrations/cloud/workspaces";
import { resolveCloudWorkspaceReadiness } from "./cloud-readiness";
import { resolveSelectionConnection } from "./connection";
import { isWorkspaceSelectionCurrent } from "./guards";
import type {
  ReadyCloudReadinessResult,
  WorkspaceConnectionResult,
  WorkspaceSelectionContext,
  WorkspaceSelectionDeps,
  WorkspaceSelectionRequest,
} from "./types";

async function invalidateCloudWorkspaceStartState(
  deps: WorkspaceSelectionDeps,
  runtimeUrl: string,
): Promise<void> {
  await Promise.all([
    deps.queryClient.invalidateQueries({
      queryKey: workspaceCollectionsScopeKey(runtimeUrl),
    }),
    deps.queryClient.invalidateQueries({
      queryKey: cloudBillingKey(),
    }),
  ]);
}

async function resolveCloudSelectionConnection(
  deps: WorkspaceSelectionDeps,
  context: WorkspaceSelectionContext,
  cloudReadiness: ReadyCloudReadinessResult,
  latencyFlowId: string | null | undefined,
): Promise<WorkspaceConnectionResult | null> {
  try {
    return await resolveSelectionConnection(deps, context, cloudReadiness);
  } catch (error) {
    if (
      cloudReadiness.kind !== "cloud-ready"
      || !isCloudWorkspaceNotReadyError(error)
    ) {
      throw error;
    }

    const startedWorkspace = await startCloudWorkspace(cloudReadiness.cloudWorkspaceId);
    await invalidateCloudWorkspaceStartState(
      deps,
      useHarnessStore.getState().runtimeUrl,
    );
    if (!isWorkspaceSelectionCurrent(context.workspaceId, context.selectionNonce)) {
      cancelLatencyFlow(latencyFlowId, "workspace_selection_stale");
      return null;
    }
    if (startedWorkspace.status !== "ready") {
      cancelLatencyFlow(latencyFlowId, "cloud_workspace_start_pending", {
        cloudWorkspaceId: cloudReadiness.cloudWorkspaceId,
        status: startedWorkspace.status,
      });
      return null;
    }

    return await resolveSelectionConnection(deps, context, cloudReadiness);
  }
}

export async function runWorkspaceSelection(
  deps: WorkspaceSelectionDeps,
  request: WorkspaceSelectionRequest,
): Promise<void> {
  const logicalWorkspace = findLogicalWorkspace(deps.logicalWorkspaces, request.workspaceId);
  if (!logicalWorkspace) {
    const directWorkspace = deps.rawWorkspaces.find(
      (workspace) => workspace.id === request.workspaceId,
    ) ?? null;
    if (directWorkspace?.surface === "cowork") {
      const selectionStartedAt = startLatencyTimer();
      const currentId = useHarnessStore.getState().selectedWorkspaceId;
      if (currentId === directWorkspace.id && !request.options?.force) {
        cancelLatencyFlow(request.options?.latencyFlowId, "workspace_already_selected");
        return;
      }

      logLatency("workspace.select.start", {
        workspaceId: directWorkspace.id,
        logicalWorkspaceId: null,
        force: !!request.options?.force,
        preservePending: !!request.options?.preservePending,
      });

      const cachedSessionId =
        useWorkspaceUiStore.getState().lastViewedSessionByWorkspace[directWorkspace.id] ?? null;
      deps.setSelectedLogicalWorkspaceId(null);
      deps.setSelectedWorkspace(directWorkspace.id, {
        clearPending: !request.options?.preservePending,
        initialActiveSessionId: cachedSessionId,
      });

      const context: WorkspaceSelectionContext = {
        workspaceId: directWorkspace.id,
        logicalWorkspaceId: directWorkspace.id,
        selectionNonce: useHarnessStore.getState().workspaceSelectionNonce,
        selectionStartedAt,
        cloudWorkspaceId: null,
      };
      if (!isWorkspaceSelectionCurrent(context.workspaceId, context.selectionNonce)) {
        cancelLatencyFlow(request.options?.latencyFlowId, "workspace_selection_stale");
        return;
      }

      const connectionResult = await resolveSelectionConnection(deps, context, { kind: "local" });
      if (!isWorkspaceSelectionCurrent(context.workspaceId, context.selectionNonce)) {
        cancelLatencyFlow(request.options?.latencyFlowId, "workspace_selection_stale");
        return;
      }

      const bootstrapResult = await deps.bootstrapWorkspace({
        workspaceId: context.workspaceId,
        logicalWorkspaceId: context.logicalWorkspaceId,
        runtimeUrl: connectionResult.runtimeUrl,
        workspaceConnection: connectionResult.workspaceConnection,
        startedAt: context.selectionStartedAt,
        latencyFlowId: request.options?.latencyFlowId,
        isCurrent: () => isWorkspaceSelectionCurrent(context.workspaceId, context.selectionNonce),
      });
      if (!isWorkspaceSelectionCurrent(context.workspaceId, context.selectionNonce)) {
        cancelLatencyFlow(request.options?.latencyFlowId, "workspace_selection_stale");
        return;
      }

      const latestSessionTimestamp = getLatestWorkspaceInteractionTimestamp(bootstrapResult.sessions);
      if (latestSessionTimestamp) {
        trackWorkspaceInteraction(context.logicalWorkspaceId, latestSessionTimestamp);
      }
      markWorkspaceViewed(context.logicalWorkspaceId);
      return;
    }

    cancelLatencyFlow(request.options?.latencyFlowId, "workspace_not_found");
    throw new Error("Workspace not found.");
  }

  const resolvedWorkspaceId = resolveLogicalWorkspaceMaterializationId(
    logicalWorkspace,
    request.workspaceId,
  );
  if (!resolvedWorkspaceId) {
    cancelLatencyFlow(request.options?.latencyFlowId, "workspace_not_materialized");
    throw new Error("Workspace is not materialized yet.");
  }
  const selectionStartedAt = startLatencyTimer();
  const currentId = useHarnessStore.getState().selectedWorkspaceId;
  if (currentId === resolvedWorkspaceId && !request.options?.force) {
    cancelLatencyFlow(request.options?.latencyFlowId, "workspace_already_selected");
    return;
  }

  logLatency("workspace.select.start", {
    workspaceId: resolvedWorkspaceId,
    logicalWorkspaceId: logicalWorkspace.id,
    force: !!request.options?.force,
    preservePending: !!request.options?.preservePending,
  });

  const cachedSessionId =
    useWorkspaceUiStore.getState().lastViewedSessionByWorkspace[logicalWorkspace.id] ?? null;
  deps.setSelectedLogicalWorkspaceId(logicalWorkspace.id);
  deps.setSelectedWorkspace(resolvedWorkspaceId, {
    clearPending: !request.options?.preservePending,
    initialActiveSessionId: cachedSessionId,
  });

  const baseContext: WorkspaceSelectionContext = {
    workspaceId: resolvedWorkspaceId,
    logicalWorkspaceId: logicalWorkspace.id,
    selectionNonce: useHarnessStore.getState().workspaceSelectionNonce,
    selectionStartedAt,
    cloudWorkspaceId: null,
  };

  const cloudReadiness = await resolveCloudWorkspaceReadiness(baseContext);
  if (
    cloudReadiness.kind === "stale"
  ) {
    cancelLatencyFlow(request.options?.latencyFlowId, "workspace_selection_stale");
    return;
  }
  if (
    cloudReadiness.kind === "cloud-missing"
    || cloudReadiness.kind === "cloud-pending"
  ) {
    cancelLatencyFlow(request.options?.latencyFlowId, cloudReadiness.kind, {
      cloudWorkspaceId: cloudReadiness.cloudWorkspaceId,
      status: cloudReadiness.kind === "cloud-pending" ? cloudReadiness.status : null,
    });
    return;
  }

  const context: WorkspaceSelectionContext = {
    ...baseContext,
    cloudWorkspaceId: cloudReadiness.kind === "cloud-ready"
      ? cloudReadiness.cloudWorkspaceId
      : null,
  };
  if (!isWorkspaceSelectionCurrent(context.workspaceId, context.selectionNonce)) {
    cancelLatencyFlow(request.options?.latencyFlowId, "workspace_selection_stale");
    return;
  }

  const connectionResult = await resolveCloudSelectionConnection(
    deps,
    context,
    cloudReadiness,
    request.options?.latencyFlowId,
  );
  if (connectionResult === null) {
    return;
  }
  if (!isWorkspaceSelectionCurrent(context.workspaceId, context.selectionNonce)) {
    cancelLatencyFlow(request.options?.latencyFlowId, "workspace_selection_stale");
    return;
  }

  const bootstrapResult = await deps.bootstrapWorkspace({
    workspaceId: context.workspaceId,
    logicalWorkspaceId: context.logicalWorkspaceId,
    runtimeUrl: connectionResult.runtimeUrl,
    workspaceConnection: connectionResult.workspaceConnection,
    startedAt: context.selectionStartedAt,
    latencyFlowId: request.options?.latencyFlowId,
    isCurrent: () => isWorkspaceSelectionCurrent(context.workspaceId, context.selectionNonce),
  });
  if (!isWorkspaceSelectionCurrent(context.workspaceId, context.selectionNonce)) {
    cancelLatencyFlow(request.options?.latencyFlowId, "workspace_selection_stale");
    return;
  }

  const latestSessionTimestamp = getLatestWorkspaceInteractionTimestamp(bootstrapResult.sessions);
  if (latestSessionTimestamp) {
    trackWorkspaceInteraction(context.logicalWorkspaceId, latestSessionTimestamp);
  }
  markWorkspaceViewed(context.logicalWorkspaceId);
}
