import { findLogicalWorkspace, resolveLogicalWorkspaceMaterializationId } from "@/lib/domain/workspaces/logical-workspaces";
import {
  resolveHotReopenCandidate,
} from "@/lib/domain/workspaces/hot-reopen";
import {
  markWorkspaceViewed,
  rememberLastViewedSession,
  useWorkspaceUiStore,
} from "@/stores/preferences/workspace-ui-store";
import {
  getMaterializedSessionId,
  getSessionRecords,
  removeSessionRecord,
} from "@/stores/sessions/session-records";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { isPendingSessionId } from "@/lib/workflows/sessions/session-runtime";
import {
  finishMeasurementOperation,
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  recordMeasurementWorkflowStep,
  startMeasurementOperation,
} from "@/lib/infra/measurement/debug-measurement";
import { scheduleAfterNextPaint } from "@/lib/infra/scheduling/schedule-after-next-paint";
import { resolveCloudWorkspaceReadiness } from "./cloud-readiness";
import { cancelPreviousWorkspaceDisplayQueries } from "./cancel-display-queries";
import { resolveSelectionConnection } from "./connection";
import { isWorkspaceSelectionCurrent } from "./guards";
import { runWorkspaceSelection } from "./run-workspace-selection";
import type {
  ReadyCloudReadinessResult,
  WorkspaceSelectionContext,
  WorkspaceSelectionDeps,
  WorkspaceSelectionRequest,
} from "./types";

const HOT_REOPEN_RECOVERY_SUPPRESSION_MS = 15_000;
const recentHotReopenRecoveries = new Map<string, number>();

export function runHotWorkspaceReopen(
  deps: WorkspaceSelectionDeps,
  request: WorkspaceSelectionRequest,
): boolean {
  if (request.options?.forceCold) {
    return false;
  }

  const logicalWorkspace = findLogicalWorkspace(deps.logicalWorkspaces, request.workspaceId);
  const directWorkspace = logicalWorkspace
    ? null
    : deps.rawWorkspaces.find((workspace) => workspace.id === request.workspaceId) ?? null;
  const resolvedWorkspaceId = logicalWorkspace
    ? resolveLogicalWorkspaceMaterializationId(logicalWorkspace, request.workspaceId)
    : directWorkspace?.id ?? null;
  if (!resolvedWorkspaceId) {
    return false;
  }

  const state = useSessionSelectionStore.getState();
  if (state.selectedWorkspaceId === resolvedWorkspaceId && !request.options?.force) {
    return false;
  }

  const candidate = resolveHotReopenCandidate({
    resolvedWorkspaceId,
    logicalWorkspace,
    initialActiveSessionId: request.options?.initialActiveSessionId ?? null,
    lastViewedSessionByWorkspace: useWorkspaceUiStore.getState().lastViewedSessionByWorkspace,
    sessionSlots: getSessionRecords(),
    isPendingSessionId,
  });
  if (!candidate) {
    return false;
  }
  if (isHotReopenRecoverySuppressed(resolvedWorkspaceId, candidate.sessionId)) {
    return false;
  }

  const logicalWorkspaceId = logicalWorkspace?.id ?? resolvedWorkspaceId;
  const startedAt = performance.now();
  const operationId = startMeasurementOperation({
    kind: "workspace_hot_reopen",
    surfaces: [
      "workspace-shell",
      "workspace-sidebar",
      "global-header",
      "header-tabs",
      "chat-surface",
      "session-transcript-pane",
      "transcript-list",
    ],
    linkedLatencyFlowId: request.options?.latencyFlowId ?? undefined,
    maxDurationMs: 2500,
  });

  const nonce = useSessionSelectionStore.getState().workspaceSelectionNonce + 1;
  cancelPreviousWorkspaceDisplayQueries({
    queryClient: deps.queryClient,
    runtimeUrl: useHarnessConnectionStore.getState().runtimeUrl,
    previousWorkspaceIds: [state.selectedLogicalWorkspaceId, state.selectedWorkspaceId],
    nextWorkspaceIds: [logicalWorkspace?.id ?? null, resolvedWorkspaceId],
  });
  useSessionSelectionStore.getState().activateHotWorkspace({
    logicalWorkspaceId: logicalWorkspace ? logicalWorkspace.id : null,
    workspaceId: resolvedWorkspaceId,
    clearPending: !request.options?.preservePending,
    initialActiveSessionId: candidate.sessionId,
    hotPaintGate: {
      workspaceId: resolvedWorkspaceId,
      sessionId: candidate.sessionId,
      nonce,
      operationId,
      kind: "workspace_hot_reopen",
    },
  });
  recordMeasurementWorkflowStep({
    operationId,
    step: "workspace.hot_reopen.activate",
    startedAt,
    outcome: candidate.source === "cached_slot" ? "cache_hit" : "completed",
  });
  if (operationId) {
    markOperationForNextCommit(operationId, [
      "workspace-shell",
      "workspace-sidebar",
      "global-header",
      "header-tabs",
      "chat-surface",
      "session-transcript-pane",
      "transcript-list",
    ]);
  }

  scheduleAfterNextPaint(() => {
    const current = useSessionSelectionStore.getState();
    if (current.hotPaintGate?.nonce !== nonce) {
      finishOrCancelMeasurementOperation(operationId, "aborted");
      return;
    }
    recordMeasurementWorkflowStep({
      operationId,
      step: "workspace.hot_reopen.after_paint",
      startedAt,
    });
    current.clearHotPaintGate(nonce);
    if (operationId) {
      finishMeasurementOperation(operationId, "completed");
    }
    const lastViewedSessionId = resolvePersistableLastViewedSessionId(candidate.sessionId);
    if (lastViewedSessionId) {
      rememberLastViewedSession(resolvedWorkspaceId, lastViewedSessionId);
    }
    if (logicalWorkspace && lastViewedSessionId) {
      rememberLastViewedSession(logicalWorkspace.id, lastViewedSessionId);
    }
    markWorkspaceViewed(logicalWorkspaceId);
    void reconcileAfterHotPaint({
      deps,
      request,
      logicalWorkspaceId,
      resolvedWorkspaceId,
      sessionId: candidate.sessionId,
      nonce,
    });
  });

  return true;
}

function resolvePersistableLastViewedSessionId(sessionId: string): string | null {
  const materializedSessionId = getMaterializedSessionId(sessionId);
  if (materializedSessionId) {
    return materializedSessionId;
  }
  return sessionId.startsWith("client-session:") || sessionId.startsWith("pending-session:")
    ? null
    : sessionId;
}

async function reconcileAfterHotPaint(input: {
  deps: WorkspaceSelectionDeps;
  request: WorkspaceSelectionRequest;
  logicalWorkspaceId: string;
  resolvedWorkspaceId: string;
  sessionId: string;
  nonce: number;
}): Promise<void> {
  const { deps, request, logicalWorkspaceId, resolvedWorkspaceId, sessionId, nonce } = input;
  const context: WorkspaceSelectionContext = {
    workspaceId: resolvedWorkspaceId,
    logicalWorkspaceId,
    selectionNonce: nonce,
    selectionStartedAt: performance.now(),
    cloudWorkspaceId: null,
  };
  const isCurrent = () =>
    isWorkspaceSelectionCurrent(resolvedWorkspaceId, nonce)
    && useSessionSelectionStore.getState().activeSessionId === sessionId;

  if (!isCurrent()) {
    return;
  }

  const cloudReadiness = await resolveCloudWorkspaceReadiness(context);
  if (!isCurrent() || cloudReadiness.kind === "stale") {
    return;
  }
  if (cloudReadiness.kind === "cloud-missing" || cloudReadiness.kind === "cloud-pending") {
    return;
  }

  const readyReadiness: ReadyCloudReadinessResult = cloudReadiness;
  const connectionResult = await resolveSelectionConnection(
    deps,
    {
      ...context,
      cloudWorkspaceId: readyReadiness.kind === "cloud-ready"
        ? readyReadiness.cloudWorkspaceId
        : null,
    },
    readyReadiness,
  ).catch(() => null);
  if (!connectionResult || !isCurrent()) {
    return;
  }

  const result = await deps.reconcileHotWorkspace({
    workspaceId: resolvedWorkspaceId,
    logicalWorkspaceId,
    runtimeUrl: connectionResult.runtimeUrl,
    workspaceConnection: connectionResult.workspaceConnection,
    sessionId,
    selectionNonce: nonce,
    latencyFlowId: request.options?.latencyFlowId,
    isCurrent,
  });
  if (result !== "session_missing" || !isCurrent()) {
    return;
  }

  suppressHotReopenRecovery(resolvedWorkspaceId, sessionId);
  removeSessionRecord(sessionId);
  const selectionState = useSessionSelectionStore.getState();
  if (selectionState.activeSessionId === sessionId) {
    selectionState.setActiveSessionId(null);
  }
  await runWorkspaceSelection(deps, {
    workspaceId: request.workspaceId,
    options: {
      ...request.options,
      force: true,
      forceCold: true,
      initialActiveSessionId: null,
    },
  });
}

function isHotReopenRecoverySuppressed(workspaceId: string, sessionId: string): boolean {
  const key = hotReopenRecoveryKey(workspaceId, sessionId);
  const suppressedUntil = recentHotReopenRecoveries.get(key) ?? 0;
  if (suppressedUntil <= performance.now()) {
    recentHotReopenRecoveries.delete(key);
    return false;
  }
  return true;
}

function suppressHotReopenRecovery(workspaceId: string, sessionId: string): void {
  recentHotReopenRecoveries.set(
    hotReopenRecoveryKey(workspaceId, sessionId),
    performance.now() + HOT_REOPEN_RECOVERY_SUPPRESSION_MS,
  );
}

function hotReopenRecoveryKey(workspaceId: string, sessionId: string): string {
  return `${workspaceId}:${sessionId}`;
}
