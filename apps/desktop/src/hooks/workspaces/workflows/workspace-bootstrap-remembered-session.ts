import type { WorkspaceSession } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";
import type { useSessionSelectionActions } from "@/hooks/sessions/facade/use-session-selection-actions";
import type { useSessionHistoryHydration } from "@/hooks/sessions/lifecycle/use-session-history-hydration";
import { selectSessionWithShellIntentRollback } from "@/hooks/sessions/workflows/session-shell-selection";
import {
  choosePreferredWorkspaceSession,
} from "@/lib/domain/workspaces/selection/selection";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/measurement/debug-latency";
import {
  recordMeasurementWorkflowStep,
} from "@/lib/infra/measurement/debug-measurement";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import {
  resolveLastViewedSessionForWorkspace,
} from "@/lib/domain/workspaces/selection/workspace-bootstrap-selection";
import type { SessionRuntimeRecord } from "@/stores/sessions/session-types";

export async function handleRememberedWorkspaceSessionBootstrap(
  input: {
    lastViewedSessionByWorkspace: Record<string, string>;
    latencyFlowId?: string | null;
    logicalWorkspaceId: string;
    measurementOperationId: MeasurementOperationId | null;
    requestHeaders?: HeadersInit;
    sessions: WorkspaceSession[];
    startedAt: number;
    workspaceId: string;
    isCurrent: () => boolean;
  },
  deps: {
    clearLastViewedSession: (workspaceId: string, sessionId?: string) => void;
    getActiveSessionId: () => string | null;
    getSessionRecord: (sessionId: string) => SessionRuntimeRecord | null;
    patchSessionRecord: (sessionId: string, patch: Partial<SessionRuntimeRecord>) => void;
    rehydrateSessionSlotFromHistory: ReturnType<
      typeof useSessionHistoryHydration
    >["rehydrateSessionSlotFromHistory"];
    selectSession: ReturnType<typeof useSessionSelectionActions>["selectSession"];
    setActiveSessionId: (sessionId: string | null) => void;
  },
): Promise<void> {
  const rememberedSession = resolveLastViewedSessionForWorkspace(
    input.lastViewedSessionByWorkspace,
    input.logicalWorkspaceId,
    input.workspaceId,
  );
  const rememberedSessionId = rememberedSession.sessionId;
  const targetSession = choosePreferredWorkspaceSession(
    input.sessions,
    rememberedSessionId,
  );
  if (rememberedSessionId && targetSession?.id !== rememberedSessionId) {
    deps.clearLastViewedSession(rememberedSession.sourceKey ?? input.logicalWorkspaceId, rememberedSessionId);
  }

  if (!targetSession || !input.isCurrent()) {
    return;
  }

  const currentActiveSessionId = deps.getActiveSessionId();
  if (currentActiveSessionId && currentActiveSessionId !== targetSession.id) {
    const currentActiveSession = deps.getSessionRecord(currentActiveSessionId);
    if (!currentActiveSession || currentActiveSession.workspaceId !== input.workspaceId) {
      deps.setActiveSessionId(null);
      logLatency("workspace.select.stale_active_session_cleared", {
        workspaceId: input.workspaceId,
        sessionId: targetSession.id,
        currentActiveSessionId,
        currentActiveWorkspaceId: currentActiveSession?.workspaceId ?? null,
        reason: currentActiveSession ? "workspace_mismatch" : "missing_slot",
        totalElapsedMs: elapsedMs(input.startedAt),
      });
    } else {
      logLatency("workspace.select.session_select.skipped", {
        workspaceId: input.workspaceId,
        sessionId: targetSession.id,
        currentActiveSessionId,
        reason: "active_session_changed",
        totalElapsedMs: elapsedMs(input.startedAt),
      });
      return;
    }
  }
  logLatency("workspace.select.session_select.start", {
    workspaceId: input.workspaceId,
    sessionId: targetSession.id,
    totalElapsedMs: elapsedMs(input.startedAt),
  });
  const sessionSelectStartedAt = performance.now();
  const selectionOutcome = await selectSessionWithShellIntentRollback({
    workspaceId: input.workspaceId,
    sessionId: targetSession.id,
    options: { latencyFlowId: input.latencyFlowId },
    selectSession: deps.selectSession,
  });
  if (selectionOutcome?.result === "stale" || !input.isCurrent()) {
    return;
  }
  recordMeasurementWorkflowStep({
    operationId: input.measurementOperationId,
    step: "workspace.bootstrap.session_select",
    startedAt: sessionSelectStartedAt,
  });
  const hydrateStartedAt = startLatencyTimer();
  await deps.rehydrateSessionSlotFromHistory(targetSession.id, {
    replace: true,
    requestHeaders: input.requestHeaders,
    measurementOperationId: input.measurementOperationId,
    isCurrent: () =>
      input.isCurrent()
      && deps.getActiveSessionId() === targetSession.id,
  });
  if (!input.isCurrent()) {
    return;
  }
  deps.patchSessionRecord(targetSession.id, { transcriptHydrated: true });
  recordMeasurementWorkflowStep({
    operationId: input.measurementOperationId,
    step: "session.select.history_hydrate",
    startedAt: hydrateStartedAt,
  });
  logLatency("workspace.select.success", {
    workspaceId: input.workspaceId,
    sessionId: targetSession.id,
    sessionCount: input.sessions.length,
    totalElapsedMs: elapsedMs(input.startedAt),
  });
}
