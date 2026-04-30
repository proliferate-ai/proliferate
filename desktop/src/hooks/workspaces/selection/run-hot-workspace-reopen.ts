import { findLogicalWorkspace, resolveLogicalWorkspaceMaterializationId } from "@/lib/domain/workspaces/logical-workspaces";
import {
  resolveHotReopenCandidate,
} from "@/lib/domain/workspaces/hot-reopen";
import {
  markWorkspaceViewed,
  rememberLastViewedSession,
  useWorkspaceUiStore,
} from "@/stores/preferences/workspace-ui-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { isPendingSessionId } from "@/lib/integrations/anyharness/session-runtime";
import {
  finishMeasurementOperation,
  markOperationForNextCommit,
  recordMeasurementWorkflowStep,
  startMeasurementOperation,
} from "@/lib/infra/debug-measurement";
import { scheduleAfterNextPaint } from "@/lib/infra/schedule-after-next-paint";
import { resolveCloudWorkspaceReadiness } from "./cloud-readiness";
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

  const state = useHarnessStore.getState();
  if (state.selectedWorkspaceId === resolvedWorkspaceId && !request.options?.force) {
    return false;
  }

  const candidate = resolveHotReopenCandidate({
    resolvedWorkspaceId,
    logicalWorkspace,
    initialActiveSessionId: request.options?.initialActiveSessionId ?? null,
    lastViewedSessionByWorkspace: useWorkspaceUiStore.getState().lastViewedSessionByWorkspace,
    sessionSlots: state.sessionSlots,
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

  deps.setSelectedLogicalWorkspaceId(logicalWorkspace ? logicalWorkspace.id : null);
  deps.setSelectedWorkspace(resolvedWorkspaceId, {
    clearPending: !request.options?.preservePending,
    initialActiveSessionId: candidate.sessionId,
  });
  rememberLastViewedSession(resolvedWorkspaceId, candidate.sessionId);
  if (logicalWorkspace) {
    rememberLastViewedSession(logicalWorkspace.id, candidate.sessionId);
  }
  markWorkspaceViewed(logicalWorkspaceId);

  const nonce = useHarnessStore.getState().workspaceSelectionNonce;
  useHarnessStore.getState().setHotPaintGate({
    workspaceId: resolvedWorkspaceId,
    sessionId: candidate.sessionId,
    nonce,
    operationId,
    kind: "workspace_hot_reopen",
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
    const current = useHarnessStore.getState();
    if (current.hotPaintGate?.nonce !== nonce) {
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
    && useHarnessStore.getState().activeSessionId === sessionId;

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
  const state = useHarnessStore.getState();
  state.removeSessionSlot(sessionId);
  if (state.activeSessionId === sessionId) {
    state.setActiveSessionId(null);
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
