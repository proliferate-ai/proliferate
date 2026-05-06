import {
  anyHarnessSessionsKey,
  getAnyHarnessClient,
} from "@anyharness/sdk-react";
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Session } from "@anyharness/sdk";
import {
  resolveStatusFromExecutionSummary,
} from "@/lib/domain/sessions/activity";
import {
  getSessionClientAndWorkspace,
  getWorkspaceClientAndId,
  isPendingSessionId,
} from "@/lib/integrations/anyharness/session-runtime";
import { bootstrapHarnessRuntime } from "@/lib/integrations/anyharness/runtime-bootstrap";
import { resolveWorkspaceConnection } from "@/lib/integrations/anyharness/resolve-workspace-connection";
import { useSessionRuntimeActions } from "@/hooks/sessions/use-session-runtime-actions";
import { useToastStore } from "@/stores/toast/toast-store";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/use-workspace-runtime-block";
import { useWorkspaceSessionCache } from "@/hooks/sessions/use-workspace-session-cache";
import { useDismissedSessionCleanup } from "@/hooks/sessions/use-dismissed-session-cleanup";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/debug-latency";
import {
  annotateLatencyFlow,
  cancelLatencyFlow,
  getLatencyFlowRequestHeaders,
} from "@/lib/infra/latency-flow";
import {
  finishOrCancelMeasurementOperation,
  finishMeasurementOperation,
  getMeasurementRequestOptions,
  markOperationForNextCommit,
  recordMeasurementMetric,
  recordMeasurementWorkflowStep,
  startMeasurementOperation,
  type MeasurementOperationId,
} from "@/lib/infra/debug-measurement";
import { isHotReopenEligibleSessionSlot } from "@/lib/domain/workspaces/hot-reopen";
import { scheduleAfterNextPaint } from "@/lib/infra/schedule-after-next-paint";
import {
  commitHotActiveSession,
  commitActiveSession,
  isSessionActivationCurrent,
  type SessionActivationGuard,
  type SessionActivationOutcome,
} from "@/hooks/sessions/session-activation-guard";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import {
  createEmptySessionRecord,
  getSessionRecord,
  patchSessionRecord,
  putSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import type {
  SessionChildRelationship,
  SessionRelationship,
} from "@/stores/sessions/session-types";
import { rememberLastViewedSession } from "@/stores/preferences/workspace-ui-store";
import { resolveWorkspaceUiKey } from "@/lib/domain/workspaces/workspace-ui-key";

export type WorkspaceSession = Session & { workspaceId: string };

export interface SelectSessionOptionsWithoutGuard {
  latencyFlowId?: string | null;
  allowColdIdleNoStream?: boolean;
  measurementOperationId?: MeasurementOperationId | null;
  reuseMeasurementOperation?: boolean;
  forceCold?: boolean;
}

type SessionLatencyFlowOptions = SelectSessionOptionsWithoutGuard & {
  guard?: SessionActivationGuard;
};

export function classifyTrustedSessionSelection(sessionId: string): SessionRelationship {
  const state = useSessionDirectoryStore.getState();
  const slot = state.entriesById[sessionId] ?? null;
  if (slot && slot.sessionRelationship.kind !== "pending") {
    return slot.sessionRelationship;
  }
  const relationshipHint =
    state.relationshipHintsBySessionId[sessionId] as SessionChildRelationship | undefined;
  const relationship = relationshipHint ?? { kind: "root" as const };
  if (relationship.kind === "root") {
    state.setSessionRelationship(sessionId, relationship);
  } else {
    state.recordRelationshipHint(sessionId, relationship);
  }
  return relationship;
}

export async function fetchWorkspaceSessions(
  runtimeUrl: string,
  workspaceId: string,
  options?: {
    requestHeaders?: HeadersInit;
    measurementOperationId?: MeasurementOperationId | null;
  },
): Promise<WorkspaceSession[]> {
  const connection = await resolveWorkspaceConnection(runtimeUrl, workspaceId);
  const sessions = await getAnyHarnessClient(connection).sessions.list(
    connection.anyharnessWorkspaceId,
    getMeasurementRequestOptions({
      operationId: options?.measurementOperationId,
      category: "session.list",
      headers: options?.requestHeaders,
    }),
  );
  return sessions.map((session) => ({
    ...session,
    workspaceId,
  }));
}

function buildLatencyRequestOptions(latencyFlowId?: string | null) {
  const headers = getLatencyFlowRequestHeaders(latencyFlowId);
  return headers ? { headers } : undefined;
}

async function ensureRuntimeReadyForSessions(): Promise<string> {
  const state = useHarnessConnectionStore.getState();
  if (state.connectionState !== "healthy" || state.runtimeUrl.trim().length === 0) {
    await bootstrapHarnessRuntime();
  }

  const readyState = useHarnessConnectionStore.getState();
  if (readyState.connectionState !== "healthy" || readyState.runtimeUrl.trim().length === 0) {
    throw new Error(readyState.error || "AnyHarness runtime is still starting. Try again.");
  }

  return readyState.runtimeUrl;
}

export function useSessionSelectionActions() {
  const queryClient = useQueryClient();
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const showToast = useToastStore((state) => state.show);
  const cleanupDismissedSession = useDismissedSessionCleanup();
  const {
    activateSession,
  } = useSessionRuntimeActions();
  const {
    upsertWorkspaceSessionRecord,
  } = useWorkspaceSessionCache();

  const ensureWorkspaceSessions = useCallback(async (
    workspaceId: string,
    options?: SessionLatencyFlowOptions,
  ) => {
    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      throw new Error(blockedReason);
    }

    const runtimeUrl = await ensureRuntimeReadyForSessions();
    const requestHeaders = getLatencyFlowRequestHeaders(options?.latencyFlowId);
    const queryKey = anyHarnessSessionsKey(runtimeUrl, workspaceId);
    const cacheState = queryClient.getQueryState(queryKey);
    if (options?.measurementOperationId) {
      recordMeasurementMetric({
        type: "cache",
        category: "session.list",
        operationId: options.measurementOperationId,
        decision: cacheState?.dataUpdatedAt
          ? cacheState.isInvalidated ? "stale" : "hit"
          : "miss",
        source: "react_query",
      });
    }
    const cachedSessions = queryClient.getQueryData<WorkspaceSession[]>(queryKey);
    if (cachedSessions && cacheState?.dataUpdatedAt && !cacheState.isInvalidated) {
      return cachedSessions;
    }

    // Do not join a possibly hung automatic query for the same selected
    // workspace. Session selection is the owning workflow and must either
    // complete or fail independently so the shell cannot stay on
    // "Preparing workspace" behind an unrelated header/sidebar fetch.
    const sessions = await fetchWorkspaceSessions(
      runtimeUrl,
      workspaceId,
      requestHeaders || options?.measurementOperationId
        ? {
          requestHeaders,
          measurementOperationId: options?.measurementOperationId,
        }
        : undefined,
    );
    queryClient.setQueryData(queryKey, sessions);
    return sessions;
  }, [getWorkspaceRuntimeBlockReason, queryClient]);

  const selectSession = useCallback(async (
    sessionId: string,
    options?: SessionLatencyFlowOptions,
  ): Promise<SessionActivationOutcome | void> => {
    const guard = options?.guard ?? null;
    const commitSelection = (): SessionActivationOutcome | null => {
      if (!guard) {
        activateSession(sessionId);
        return null;
      }
      const outcome = commitActiveSession(sessionId, guard);
      return outcome;
    };
    const staleSelection = (
      reason: Extract<SessionActivationOutcome, { result: "stale" }>["reason"],
    ): SessionActivationOutcome | void => {
      if (measurementOperationId) {
        finishMeasurementOperation(measurementOperationId, "aborted");
      }
      return guard
        ? { result: "stale", sessionId, guard, reason }
        : undefined;
    };
    const startedAt = startLatencyTimer();
    const measurementOperationId = options?.reuseMeasurementOperation
      ? options.measurementOperationId ?? null
      : startMeasurementOperation({
        kind: "session_switch",
        surfaces: [
          "workspace-shell",
          "chat-surface",
          "session-transcript-pane",
          "transcript-list",
          "header-tabs",
          "workspace-sidebar",
        ],
        linkedLatencyFlowId: options?.latencyFlowId ?? undefined,
        maxDurationMs: 30_000,
      });
    const current = useSessionSelectionStore.getState();
    let existingSlot = getSessionRecord(sessionId);
    logLatency("session.select.start", {
      sessionId,
      flowId: options?.latencyFlowId ?? null,
      hasExistingSlot: existingSlot !== null,
      selectedWorkspaceId: current.selectedWorkspaceId,
    });
    if (guard && !isSessionActivationCurrent(guard)) {
      return staleSelection("intent-replaced");
    }

    const sessionSelectionRelationship = classifyTrustedSessionSelection(sessionId);
    if (existingSlot?.sessionRelationship.kind === "pending") {
      existingSlot = {
        ...existingSlot,
        sessionRelationship: sessionSelectionRelationship,
      };
    }

    if (existingSlot) {
      annotateLatencyFlow(options?.latencyFlowId, {
        targetSessionId: sessionId,
        targetWorkspaceId: existingSlot.workspaceId,
      });
      const canHotSwitch = !options?.forceCold
        && !!existingSlot.workspaceId
        && isHotReopenEligibleSessionSlot(
          existingSlot,
          existingSlot.workspaceId,
          isPendingSessionId,
        );
      if (canHotSwitch) {
        const hotStartedAt = performance.now();
        const hotOperationId = options?.reuseMeasurementOperation
          ? measurementOperationId
          : startMeasurementOperation({
            kind: "session_hot_switch",
            surfaces: [
              "workspace-shell",
              "chat-surface",
              "session-transcript-pane",
              "transcript-list",
              "header-tabs",
              "workspace-sidebar",
            ],
            linkedLatencyFlowId: options?.latencyFlowId ?? undefined,
            maxDurationMs: 2500,
          });
        const gateState = useSessionSelectionStore.getState();
        const previousHotOperationId = gateState.hotPaintGate?.operationId ?? null;
        if (previousHotOperationId && previousHotOperationId !== hotOperationId) {
          finishOrCancelMeasurementOperation(previousHotOperationId, "aborted");
        }
        const nonce = gateState.workspaceSelectionNonce;
        const hotPaintGate = {
          workspaceId: existingSlot.workspaceId!,
          sessionId,
          nonce,
          operationId: hotOperationId,
          kind: "session_hot_switch",
        } as const;
        const commitOutcome = guard
          ? commitHotActiveSession(sessionId, guard, hotPaintGate)
          : (useSessionSelectionStore.getState().activateHotSession({
            sessionId,
            workspaceId: existingSlot.workspaceId!,
            hotPaintGate,
          }), null);
        if (commitOutcome?.result === "stale") {
          finishOrCancelMeasurementOperation(hotOperationId, "aborted");
          return commitOutcome;
        }
        recordMeasurementWorkflowStep({
          operationId: hotOperationId,
          step: "session.select.hot_slot_activate",
          startedAt: hotStartedAt,
          outcome: existingSlot.transcriptHydrated ? "cache_hit" : "cache_miss",
        });
        if (hotOperationId) {
          markOperationForNextCommit(hotOperationId, [
            "workspace-shell",
            "chat-surface",
            "session-transcript-pane",
            "transcript-list",
            "header-tabs",
            "workspace-sidebar",
          ]);
        }
        scheduleAfterNextPaint(() => {
          const currentState = useSessionSelectionStore.getState();
          if (
            currentState.hotPaintGate?.nonce !== nonce
            || currentState.activeSessionId !== sessionId
          ) {
            finishOrCancelMeasurementOperation(hotOperationId, "aborted");
            return;
          }
          currentState.clearHotPaintGate(nonce);
          if (hotOperationId) {
            finishMeasurementOperation(hotOperationId, "completed");
          }
          const selection = useSessionSelectionStore.getState();
          const viewedSessionId = existingSlot.materializedSessionId ?? sessionId;
          rememberLastViewedSession(
            resolveWorkspaceUiKey(
              selection.selectedLogicalWorkspaceId,
              existingSlot.workspaceId!,
            ) ?? existingSlot.workspaceId!,
            viewedSessionId,
          );
        });
        if (measurementOperationId && measurementOperationId !== hotOperationId) {
          finishMeasurementOperation(measurementOperationId, "completed");
        }
        return commitOutcome ?? undefined;
      }
      const activateStartedAt = performance.now();
      const commitOutcome = commitSelection();
      if (commitOutcome?.result === "stale") {
        return commitOutcome;
      }
      recordMeasurementWorkflowStep({
        operationId: measurementOperationId,
        step: "session.select.hot_slot_activate",
        startedAt: activateStartedAt,
        outcome: existingSlot.transcriptHydrated ? "cache_hit" : "cache_miss",
      });
      if (
        existingSlot.streamConnectionState === "connecting"
        || existingSlot.streamConnectionState === "open"
      ) {
        logLatency("session.select.reused_live_slot", {
          sessionId,
          workspaceId: existingSlot.workspaceId,
          streamConnectionState: existingSlot.streamConnectionState,
          flowId: options?.latencyFlowId ?? null,
          totalElapsedMs: elapsedMs(startedAt),
        });
        if (measurementOperationId) {
          finishMeasurementOperation(measurementOperationId, "completed");
        }
        return commitOutcome ?? undefined;
      }
    }

    const workspaceId = existingSlot?.workspaceId ?? current.selectedWorkspaceId;
    if (!workspaceId) {
      throw new Error("No workspace selected");
    }
    annotateLatencyFlow(options?.latencyFlowId, {
      targetSessionId: sessionId,
      targetWorkspaceId: workspaceId,
    });

    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason && existingSlot) {
      const commitOutcome = commitSelection();
      if (commitOutcome?.result === "stale") {
        return commitOutcome;
      }
      if (measurementOperationId) {
        finishMeasurementOperation(measurementOperationId, "completed");
      }
      return commitOutcome ?? undefined;
    }
    if (blockedReason) {
      throw new Error(blockedReason);
    }

    const sessionsLoadStartedAt = startLatencyTimer();
    const sessions = await ensureWorkspaceSessions(workspaceId, {
      ...options,
      measurementOperationId,
    });
    recordMeasurementWorkflowStep({
      operationId: measurementOperationId,
      step: "session.select.ensure_sessions",
      startedAt: sessionsLoadStartedAt,
      count: sessions.length,
    });
    logLatency("session.select.sessions_loaded", {
      sessionId,
      workspaceId,
      sessionCount: sessions.length,
      flowId: options?.latencyFlowId ?? null,
      elapsedMs: elapsedMs(sessionsLoadStartedAt),
      totalElapsedMs: elapsedMs(startedAt),
    });
    const sessionMeta = sessions.find((session) => session.id === sessionId) ?? null;
    const agentKind = existingSlot?.agentKind ?? sessionMeta?.agentKind ?? "unknown";

    if (!existingSlot) {
      const storeStartedAt = performance.now();
      putSessionRecord({
        ...createEmptySessionRecord(sessionId, agentKind, {
          workspaceId,
          modelId: sessionMeta?.modelId ?? null,
          modeId: sessionMeta?.modeId ?? null,
          title: sessionMeta?.title ?? null,
          liveConfig: sessionMeta?.liveConfig ?? null,
          executionSummary: sessionMeta?.executionSummary ?? null,
          mcpBindingSummaries: sessionMeta?.mcpBindingSummaries ?? null,
          lastPromptAt: sessionMeta?.lastPromptAt ?? null,
          sessionRelationship: sessionSelectionRelationship,
        }),
        status: resolveStatusFromExecutionSummary(
          sessionMeta?.executionSummary ?? null,
          sessionMeta?.status ?? "idle",
        ),
      });
      if (measurementOperationId) {
        recordMeasurementMetric({
          type: "store",
          category: "session.list",
          operationId: measurementOperationId,
          durationMs: performance.now() - storeStartedAt,
        });
      }
      recordMeasurementWorkflowStep({
        operationId: measurementOperationId,
        step: "session.select.slot_store",
        startedAt: storeStartedAt,
        outcome: "cache_miss",
      });
      const commitOutcome = commitSelection();
      if (commitOutcome?.result === "stale") {
        return commitOutcome;
      }
    } else {
      const storeStartedAt = performance.now();
      patchSessionRecord(sessionId, {
        workspaceId,
        agentKind,
        modelId: sessionMeta?.modelId ?? existingSlot.modelId ?? null,
        modeId: sessionMeta?.modeId ?? existingSlot.modeId ?? null,
        title: sessionMeta?.title ?? existingSlot.title ?? null,
        liveConfig: sessionMeta?.liveConfig ?? existingSlot.liveConfig ?? null,
        executionSummary: sessionMeta?.executionSummary ?? existingSlot.executionSummary ?? null,
        mcpBindingSummaries: sessionMeta?.mcpBindingSummaries ?? existingSlot.mcpBindingSummaries ?? null,
        status: resolveStatusFromExecutionSummary(
          sessionMeta?.executionSummary ?? existingSlot.executionSummary ?? null,
          sessionMeta?.status ?? existingSlot.status,
        ),
        lastPromptAt: sessionMeta?.lastPromptAt ?? existingSlot.lastPromptAt ?? null,
      });
      if (measurementOperationId) {
        recordMeasurementMetric({
          type: "store",
          category: "session.list",
          operationId: measurementOperationId,
          durationMs: performance.now() - storeStartedAt,
        });
      }
      recordMeasurementWorkflowStep({
        operationId: measurementOperationId,
        step: "session.select.slot_store",
        startedAt: storeStartedAt,
        outcome: "cache_hit",
      });
    }

    logLatency("session.select.completed", {
      sessionId,
      workspaceId,
      flowId: options?.latencyFlowId ?? null,
      totalElapsedMs: elapsedMs(startedAt),
    });
    if (measurementOperationId) {
      markOperationForNextCommit(measurementOperationId, [
        "workspace-shell",
        "chat-surface",
        "session-transcript-pane",
        "transcript-list",
        "header-tabs",
        "workspace-sidebar",
      ]);
      finishMeasurementOperation(measurementOperationId, "completed");
    }
    if (guard) {
      return {
        result: "completed",
        sessionId,
        guard,
        activeSessionVersion: useSessionSelectionStore.getState().activeSessionVersion,
      };
    }
  }, [
    activateSession,
    ensureWorkspaceSessions,
    getWorkspaceRuntimeBlockReason,
  ]);

  const dismissSession = useCallback(async (sessionId: string) => {
    const state = useSessionSelectionStore.getState();
    const closingSlot = getSessionRecord(sessionId);
    const workspaceId = closingSlot?.workspaceId ?? state.selectedWorkspaceId;

    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      showToast(blockedReason);
      return;
    }

    try {
      const { connection, materializedSessionId } =
        await getSessionClientAndWorkspace(sessionId);
      await getAnyHarnessClient(connection).sessions.dismiss(materializedSessionId);
    } catch {
      // Dismiss failed.
    }

    cleanupDismissedSession(sessionId, workspaceId);
  }, [
    cleanupDismissedSession,
    getWorkspaceRuntimeBlockReason,
    showToast,
  ]);

  const restoreLastDismissedSession = useCallback(async (
    options?: SessionLatencyFlowOptions,
  ): Promise<string | null> => {
    const startedAt = startLatencyTimer();
    const workspaceId = useSessionSelectionStore.getState().selectedWorkspaceId;
    logLatency("session.restore.start", {
      workspaceId,
      flowId: options?.latencyFlowId ?? null,
    });
    if (!workspaceId) {
      logLatency("session.restore.cancelled", {
        reason: "no_workspace_selected",
        flowId: options?.latencyFlowId ?? null,
        totalElapsedMs: elapsedMs(startedAt),
      });
      cancelLatencyFlow(options?.latencyFlowId, "no_workspace_selected");
      return null;
    }
    annotateLatencyFlow(options?.latencyFlowId, {
      targetWorkspaceId: workspaceId,
    });

    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      logLatency("session.restore.blocked", {
        workspaceId,
        blockedReason,
        flowId: options?.latencyFlowId ?? null,
        totalElapsedMs: elapsedMs(startedAt),
      });
      cancelLatencyFlow(options?.latencyFlowId, "workspace_runtime_blocked", {
        blockedReason,
      });
      showToast(blockedReason);
      return null;
    }

    try {
      const runtimeReadyStartedAt = startLatencyTimer();
      const runtimeUrl = await ensureRuntimeReadyForSessions();
      logLatency("session.restore.runtime_ready", {
        workspaceId,
        flowId: options?.latencyFlowId ?? null,
        elapsedMs: elapsedMs(runtimeReadyStartedAt),
        totalElapsedMs: elapsedMs(startedAt),
      });

      const targetResolveStartedAt = startLatencyTimer();
      const { connection, target } = await getWorkspaceClientAndId(runtimeUrl, workspaceId);
      logLatency("session.restore.target_resolved", {
        workspaceId,
        anyharnessWorkspaceId: target.anyharnessWorkspaceId,
        flowId: options?.latencyFlowId ?? null,
        elapsedMs: elapsedMs(targetResolveStartedAt),
        totalElapsedMs: elapsedMs(startedAt),
      });

      const requestOptions = buildLatencyRequestOptions(options?.latencyFlowId);
      const restoreRequestStartedAt = startLatencyTimer();
      const restored = await getAnyHarnessClient(connection).sessions.restoreDismissed(
        target.anyharnessWorkspaceId,
        requestOptions,
      );
      logLatency("session.restore.request_completed", {
        workspaceId,
        restored: restored !== null,
        sessionId: restored?.id ?? null,
        flowId: options?.latencyFlowId ?? null,
        elapsedMs: elapsedMs(restoreRequestStartedAt),
        totalElapsedMs: elapsedMs(startedAt),
      });
      if (!restored) {
        logLatency("session.restore.empty", {
          workspaceId,
          flowId: options?.latencyFlowId ?? null,
          totalElapsedMs: elapsedMs(startedAt),
        });
        cancelLatencyFlow(options?.latencyFlowId, "session_restore_empty");
        return null;
      }
      annotateLatencyFlow(options?.latencyFlowId, {
        targetSessionId: restored.id,
      });

      upsertWorkspaceSessionRecord(workspaceId, restored);
      logLatency("session.restore.cache_upserted", {
        workspaceId,
        sessionId: restored.id,
        flowId: options?.latencyFlowId ?? null,
        totalElapsedMs: elapsedMs(startedAt),
      });

      logLatency("session.restore.completed", {
        workspaceId,
        sessionId: restored.id,
        flowId: options?.latencyFlowId ?? null,
        totalElapsedMs: elapsedMs(startedAt),
      });
      return restored.id;
    } catch (error) {
      logLatency("session.restore.failed", {
        workspaceId,
        flowId: options?.latencyFlowId ?? null,
        error: error instanceof Error ? error.name : "unknown",
        totalElapsedMs: elapsedMs(startedAt),
      });
      throw error;
    }
  }, [
    getWorkspaceRuntimeBlockReason,
    showToast,
    upsertWorkspaceSessionRecord,
  ]);

  return {
    dismissSession,
    ensureWorkspaceSessions,
    restoreLastDismissedSession,
    selectSession,
  };
}
