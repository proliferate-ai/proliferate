import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import {
  createEmptySessionRecord,
  getSessionRecord,
  patchSessionRecord,
  putSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { writeChatShellIntentForSession } from "@/hooks/workspaces/workflows/tabs/workspace-shell-intent-writer";
import {
  findLogicalWorkspace,
  logicalWorkspaceRelatedIds,
} from "@/lib/domain/workspaces/cloud/logical-workspace-lookup";
import { parseTargetWorkspaceSyntheticId } from "@/lib/domain/compute/target-workspace-id";
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
import { resolveCloudWorkspaceReadiness } from "./cloud-readiness";
import { resolveSelectionConnection } from "./connection";
import { isWorkspaceSelectionCurrent } from "./guards";
import {
  prepareOptimisticWorkspaceSessionShell,
  resolveInitialActiveSessionId,
} from "./initial-session";
import {
  resolveCloudSelectionConnectionWithStatusRefresh,
} from "./cloud-selection-connection";
import type {
  WorkspaceSelectionContext,
  WorkspaceSelectionDeps,
  WorkspaceSelectionRequest,
} from "./types";

const INITIAL_SESSION_DEPS = {
  createEmptySessionRecord,
  getSessionRecord,
  logLatency,
  patchSessionRecord,
  putSessionRecord,
  writeChatShellIntentForSession,
};

export async function runWorkspaceSelection(
  deps: WorkspaceSelectionDeps,
  request: WorkspaceSelectionRequest,
): Promise<void> {
  const logicalWorkspace = findLogicalWorkspace(deps.logicalWorkspaces, request.workspaceId);
  if (!logicalWorkspace) {
    const targetWorkspace = parseTargetWorkspaceSyntheticId(request.workspaceId);
    if (targetWorkspace) {
      const selectionStartedAt = startLatencyTimer();
      const previousSelection = useSessionSelectionStore.getState();
      const currentId = previousSelection.selectedWorkspaceId;
      if (currentId === request.workspaceId && !request.options?.force) {
        cancelLatencyFlow(request.options?.latencyFlowId, "workspace_already_selected");
        return;
      }

      logLatency("workspace.select.start", {
        workspaceId: request.workspaceId,
        logicalWorkspaceId: request.workspaceId,
        force: !!request.options?.force,
        preservePending: !!request.options?.preservePending,
        targetId: targetWorkspace.targetId,
      });

      const workspaceUiState = useWorkspaceUiStore.getState();
      const initialActiveSessionId = resolveInitialActiveSessionId({
        workspaceId: request.workspaceId,
        workspaceUiKey: request.workspaceId,
        workspaceUiKeys: [request.workspaceId],
        options: request.options,
        workspaceUiState,
      }, INITIAL_SESSION_DEPS);
      deps.cache.cancelPreviousWorkspaceDisplayQueries({
        runtimeUrl: useHarnessConnectionStore.getState().runtimeUrl,
        previousWorkspaceIds: [
          previousSelection.selectedLogicalWorkspaceId,
          previousSelection.selectedWorkspaceId,
        ],
        nextWorkspaceIds: [request.workspaceId],
      });
      deps.setSelectedLogicalWorkspaceId(request.workspaceId);
      deps.setSelectedWorkspace(request.workspaceId, {
        clearPending: !request.options?.preservePending,
        initialActiveSessionId,
      });
      prepareOptimisticWorkspaceSessionShell({
        sessionId: initialActiveSessionId,
        workspaceId: request.workspaceId,
        workspaceUiKey: request.workspaceId,
      }, INITIAL_SESSION_DEPS);

      const context: WorkspaceSelectionContext = {
        workspaceId: request.workspaceId,
        logicalWorkspaceId: request.workspaceId,
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
        workspaceId: connectionResult.materializedWorkspaceId ?? context.workspaceId,
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

      const workspaceUiState = useWorkspaceUiStore.getState();
      const initialActiveSessionId = resolveInitialActiveSessionId({
        workspaceId: directWorkspace.id,
        workspaceUiKey: directWorkspace.id,
        workspaceUiKeys: [directWorkspace.id],
        options: request.options,
        workspaceUiState,
      }, INITIAL_SESSION_DEPS);
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
      prepareOptimisticWorkspaceSessionShell({
        sessionId: initialActiveSessionId,
        workspaceId: directWorkspace.id,
        workspaceUiKey: directWorkspace.id,
      }, INITIAL_SESSION_DEPS);

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
        workspaceId: connectionResult.materializedWorkspaceId ?? context.workspaceId,
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

  const workspaceUiState = useWorkspaceUiStore.getState();
  const initialActiveSessionId = resolveInitialActiveSessionId({
    workspaceId: resolvedWorkspaceId,
    workspaceUiKey: logicalWorkspace.id,
    workspaceUiKeys: logicalWorkspaceRelatedIds(logicalWorkspace),
    options: request.options,
    workspaceUiState,
  }, INITIAL_SESSION_DEPS);
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
  prepareOptimisticWorkspaceSessionShell({
    sessionId: initialActiveSessionId,
    workspaceId: resolvedWorkspaceId,
    workspaceUiKey: logicalWorkspace.id,
  }, INITIAL_SESSION_DEPS);

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

  const connectionResult = await resolveCloudSelectionConnectionWithStatusRefresh({
    cloudReadiness,
    context,
    latencyFlowId: request.options?.latencyFlowId,
    runtimeUrl: useHarnessConnectionStore.getState().runtimeUrl,
    selectionDeps: deps,
  }, {
    isCloudWorkspaceNotReadyError,
    resolveSelectionConnection,
  });
  if (connectionResult === null) {
    return;
  }
  if (!isWorkspaceSelectionCurrent(context.workspaceId, context.selectionNonce)) {
    cancelLatencyFlow(request.options?.latencyFlowId, "workspace_selection_stale");
    return;
  }

  const bootstrapResult = await deps.bootstrapWorkspace({
    workspaceId: connectionResult.materializedWorkspaceId ?? context.workspaceId,
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
