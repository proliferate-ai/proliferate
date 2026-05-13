import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import {
  createEmptySessionRecord,
  getSessionRecord,
  patchSessionRecord,
  putSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { writeChatShellIntentForSession } from "@/hooks/workspaces/tabs/workspace-shell-intent-writer";
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
import {
  OPTIMISTIC_WORKSPACE_SESSION_AGENT_KIND,
  OPTIMISTIC_WORKSPACE_SESSION_TITLE,
  resolveOptimisticWorkspaceSessionId,
} from "@/lib/domain/workspaces/selection/optimistic-session-shell";
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
  workspaceUiKey: string,
  options: WorkspaceSelectionOptions | undefined,
  workspaceUiState: {
    lastViewedSessionByWorkspace: Record<string, string>;
    visibleChatSessionIdsByWorkspace: Record<string, string[]>;
  },
): string | null {
  const candidate = resolveOptimisticWorkspaceSessionId({
    explicitInitialSessionId: options?.initialActiveSessionId,
    hasExplicitInitialSessionId: !!options && "initialActiveSessionId" in options,
    lastViewedSessionByWorkspace: workspaceUiState.lastViewedSessionByWorkspace,
    materializedWorkspaceId: workspaceId,
    visibleChatSessionIdsByWorkspace: workspaceUiState.visibleChatSessionIdsByWorkspace,
    workspaceUiKey,
  });
  if (!candidate) {
    return null;
  }

  const cachedSlot = getSessionRecord(candidate);
  return cachedSlot?.workspaceId && cachedSlot.workspaceId !== workspaceId
    ? null
    : candidate;
}

function prepareOptimisticWorkspaceSessionShell(input: {
  sessionId: string | null;
  workspaceId: string;
  workspaceUiKey: string;
}): void {
  if (!input.sessionId) {
    return;
  }

  const existing = getSessionRecord(input.sessionId);
  if (!existing) {
    putSessionRecord(createEmptySessionRecord(
      input.sessionId,
      OPTIMISTIC_WORKSPACE_SESSION_AGENT_KIND,
      {
        materializedSessionId: input.sessionId,
        sessionRelationship: { kind: "root" },
        title: OPTIMISTIC_WORKSPACE_SESSION_TITLE,
        workspaceId: input.workspaceId,
      },
    ));
  } else if (!existing.workspaceId || !existing.materializedSessionId) {
    patchSessionRecord(input.sessionId, {
      materializedSessionId: existing.materializedSessionId ?? input.sessionId,
      workspaceId: existing.workspaceId ?? input.workspaceId,
    });
  }

  writeChatShellIntentForSession({
    workspaceId: input.workspaceId,
    shellWorkspaceId: input.workspaceUiKey,
    sessionId: input.sessionId,
    invalidateSessionIntent: false,
  });
  logLatency("workspace.select.optimistic_session_shell", {
    workspaceId: input.workspaceId,
    workspaceUiKey: input.workspaceUiKey,
    sessionId: input.sessionId,
    createdRecord: !existing,
  });
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

      const workspaceUiState = useWorkspaceUiStore.getState();
      const initialActiveSessionId = resolveInitialActiveSessionId(
        directWorkspace.id,
        directWorkspace.id,
        request.options,
        workspaceUiState,
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
      prepareOptimisticWorkspaceSessionShell({
        sessionId: initialActiveSessionId,
        workspaceId: directWorkspace.id,
        workspaceUiKey: directWorkspace.id,
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

  const workspaceUiState = useWorkspaceUiStore.getState();
  const initialActiveSessionId = resolveInitialActiveSessionId(
    resolvedWorkspaceId,
    logicalWorkspace.id,
    request.options,
    workspaceUiState,
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
  prepareOptimisticWorkspaceSessionShell({
    sessionId: initialActiveSessionId,
    workspaceId: resolvedWorkspaceId,
    workspaceUiKey: logicalWorkspace.id,
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
