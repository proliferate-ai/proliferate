import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { getSessionRecord } from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { findLogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-lookup";
import { resolveLogicalWorkspaceMaterializationId } from "@/lib/domain/workspaces/cloud/logical-workspace-materialization";
import {
  markWorkspaceViewed,
  markWorkspaceViewedAt,
  trackWorkspaceInteraction,
  useWorkspaceUiStore,
} from "@/stores/preferences/workspace-ui-store";
import { getLatestWorkspaceInteractionTimestamp } from "@/lib/domain/workspaces/selection/selection";
import {
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/measurement/debug-latency";
import { cancelLatencyFlow } from "@/lib/infra/measurement/latency-flow";
import { isCloudWorkspaceNotReadyError } from "@/hooks/access/cloud/use-cloud-workspace-connection";
import { startCloudWorkspace } from "@/lib/access/cloud/workspaces";
import { resolveCloudWorkspaceReadiness } from "./cloud-readiness";
import { resolveSelectionConnection } from "./connection";
import { isWorkspaceSelectionCurrent } from "./guards";
import type {
  ReadyCloudReadinessResult,
  WorkspaceSelectionOptions,
  WorkspaceConnectionResult,
  WorkspaceSelectionContext,
  WorkspaceSelectionDeps,
  WorkspaceSelectionRequest,
} from "./types";

function resolveInitialActiveSessionId(
  workspaceId: string,
  options: WorkspaceSelectionOptions | undefined,
  cachedSessionId: string | null,
): string | null {
  if (options && "initialActiveSessionId" in options) {
    return options.initialActiveSessionId ?? null;
  }
  if (!cachedSessionId) {
    return null;
  }

  const cachedSlot = getSessionRecord(cachedSessionId);
  return cachedSlot?.workspaceId === workspaceId ? cachedSessionId : null;
}

async function invalidateCloudWorkspaceStartState(
  deps: WorkspaceSelectionDeps,
  runtimeUrl: string,
): Promise<void> {
  await deps.cache.invalidateCloudWorkspaceStartState(runtimeUrl);
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
      useHarnessConnectionStore.getState().runtimeUrl,
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
      const previousSelection = useSessionSelectionStore.getState();
      const currentId = previousSelection.selectedWorkspaceId;
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
      const initialActiveSessionId = resolveInitialActiveSessionId(
        directWorkspace.id,
        request.options,
        cachedSessionId,
      );
      deps.cache.cancelPreviousWorkspaceDisplayQueries({
        runtimeUrl: useHarnessConnectionStore.getState().runtimeUrl,
        previousWorkspaceIds: [
          previousSelection.selectedLogicalWorkspaceId,
          previousSelection.selectedWorkspaceId,
        ],
        nextWorkspaceIds: [directWorkspace.id],
      });
      deps.setSelectedLogicalWorkspaceId(null);
      deps.setSelectedWorkspace(directWorkspace.id, {
        clearPending: !request.options?.preservePending,
        initialActiveSessionId,
      });

      const context: WorkspaceSelectionContext = {
        workspaceId: directWorkspace.id,
        logicalWorkspaceId: directWorkspace.id,
        selectionNonce: useSessionSelectionStore.getState().workspaceSelectionNonce,
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
        markWorkspaceViewedAt(context.logicalWorkspaceId, latestSessionTimestamp);
      } else {
        markWorkspaceViewed(context.logicalWorkspaceId);
      }
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
  const previousSelection = useSessionSelectionStore.getState();
  const currentId = previousSelection.selectedWorkspaceId;
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
  const initialActiveSessionId = resolveInitialActiveSessionId(
    resolvedWorkspaceId,
    request.options,
    cachedSessionId,
  );
  deps.cache.cancelPreviousWorkspaceDisplayQueries({
    runtimeUrl: useHarnessConnectionStore.getState().runtimeUrl,
    previousWorkspaceIds: [
      previousSelection.selectedLogicalWorkspaceId,
      previousSelection.selectedWorkspaceId,
    ],
    nextWorkspaceIds: [logicalWorkspace.id, resolvedWorkspaceId],
  });
  deps.setSelectedLogicalWorkspaceId(logicalWorkspace.id);
  deps.setSelectedWorkspace(resolvedWorkspaceId, {
    clearPending: !request.options?.preservePending,
    initialActiveSessionId,
  });

  const baseContext: WorkspaceSelectionContext = {
    workspaceId: resolvedWorkspaceId,
    logicalWorkspaceId: logicalWorkspace.id,
    selectionNonce: useSessionSelectionStore.getState().workspaceSelectionNonce,
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
    markWorkspaceViewedAt(context.logicalWorkspaceId, latestSessionTimestamp);
  } else {
    markWorkspaceViewed(context.logicalWorkspaceId);
  }
}
