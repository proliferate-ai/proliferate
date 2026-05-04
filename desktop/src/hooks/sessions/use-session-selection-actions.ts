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
  useHarnessStore,
  type SessionChildRelationship,
  type SessionRelationship,
} from "@/stores/sessions/harness-store";
import {
  createEmptySessionSlot,
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
  commitActiveSession,
  isSessionActivationCurrent,
  type SessionActivationGuard,
  type SessionActivationOutcome,
} from "@/hooks/sessions/session-activation-guard";

export type WorkspaceSession = Session & { workspaceId: string };

const INITIAL_SESSION_HISTORY_EVENT_BUDGET = 3_000;

export interface SelectSessionOptionsWithoutGuard {
  latencyFlowId?: string | null;
  allowColdIdleNoStream?: boolean;
  measurementOperationId?: MeasurementOperationId | null;
  forceCold?: boolean;
}

type SessionLatencyFlowOptions = SelectSessionOptionsWithoutGuard & {
  guard?: SessionActivationGuard;
};

export function classifyTrustedSessionSelection(sessionId: string): SessionRelationship {
  const state = useHarnessStore.getState();
  const slot = state.sessionSlots[sessionId] ?? null;
  if (slot && slot.sessionRelationship.kind !== "pending") {
    return slot.sessionRelationship;
  }
  const relationshipHint =
    state.sessionRelationshipHints[sessionId] as SessionChildRelationship | undefined;
  const relationship = relationshipHint ?? { kind: "root" as const };
  if (relationship.kind === "root") {
    state.setSessionRelationship(sessionId, relationship);
  } else {
    state.recordSessionRelationshipHint(sessionId, relationship);
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
  const state = useHarnessStore.getState();
  if (state.connectionState !== "healthy" || state.runtimeUrl.trim().length === 0) {
    await bootstrapHarnessRuntime();
  }

  const readyState = useHarnessStore.getState();
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
    ensureSessionStreamConnected,
    rehydrateSessionSlotFromHistory,
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
    const measurementOperationId = startMeasurementOperation({
      kind: "session_switch",
      surfaces: [
        "chat-surface",
        "session-transcript-pane",
        "transcript-list",
        "header-tabs",
        "workspace-sidebar",
      ],
      linkedLatencyFlowId: options?.latencyFlowId ?? undefined,
      maxDurationMs: 30_000,
    });
    const current = useHarnessStore.getState();
    let existingSlot = current.sessionSlots[sessionId] ?? null;
    const requestHeaders = getLatencyFlowRequestHeaders(options?.latencyFlowId);
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
        const hotOperationId = startMeasurementOperation({
          kind: "session_hot_switch",
          surfaces: [
            "chat-surface",
            "session-transcript-pane",
            "transcript-list",
            "header-tabs",
            "workspace-sidebar",
          ],
          linkedLatencyFlowId: options?.latencyFlowId ?? undefined,
          maxDurationMs: 2500,
        });
        const commitOutcome = commitSelection();
        if (commitOutcome?.result === "stale") {
          return commitOutcome;
        }
        const nonce = useHarnessStore.getState().workspaceSelectionNonce;
        useHarnessStore.getState().setHotPaintGate({
          workspaceId: existingSlot.workspaceId!,
          sessionId,
          nonce,
          operationId: hotOperationId,
          kind: "session_hot_switch",
        });
        recordMeasurementWorkflowStep({
          operationId: hotOperationId,
          step: "session.select.hot_slot_activate",
          startedAt: hotStartedAt,
          outcome: existingSlot.transcriptHydrated ? "cache_hit" : "cache_miss",
        });
        if (hotOperationId) {
          markOperationForNextCommit(hotOperationId, [
            "chat-surface",
            "session-transcript-pane",
            "transcript-list",
            "header-tabs",
            "workspace-sidebar",
          ]);
        }
        scheduleAfterNextPaint(() => {
          const currentState = useHarnessStore.getState();
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
          void ensureSessionStreamConnected(sessionId, {
            allowColdIdleNoStream: options?.allowColdIdleNoStream,
            resumeIfActive: true,
            requestHeaders,
            isCurrent: () => {
              if (guard && !isSessionActivationCurrent(guard)) {
                return false;
              }
              const state = useHarnessStore.getState();
              return state.workspaceSelectionNonce === nonce
                && state.activeSessionId === sessionId;
            },
          });
        });
        if (measurementOperationId) {
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
      useHarnessStore.getState().putSessionSlot(sessionId, {
        ...createEmptySessionSlot(sessionId, agentKind, {
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
      useHarnessStore.getState().patchSessionSlot(sessionId, {
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

    const currentSlot = useHarnessStore.getState().sessionSlots[sessionId] ?? null;
    let streamConnectDeferredUntilHydrate = false;
    const scheduleStreamConnect = () => {
      const streamStartedAt = performance.now();
      recordMeasurementWorkflowStep({
        operationId: measurementOperationId,
        step: "session.select.stream_connect_scheduled",
        startedAt: streamStartedAt,
        outcome: "completed",
      });
      void ensureSessionStreamConnected(sessionId, {
        allowColdIdleNoStream: options?.allowColdIdleNoStream,
        resumeIfActive: true,
        requestHeaders,
        skipInitialRefresh: true,
        refreshOnStartupReady: true,
        isCurrent: () => {
          if (guard && !isSessionActivationCurrent(guard)) {
            return false;
          }
          const state = useHarnessStore.getState();
          return state.activeSessionId === sessionId
            && state.selectedWorkspaceId === workspaceId;
        },
      });
      logLatency("session.select.stream_connected", {
        sessionId,
        workspaceId,
        flowId: options?.latencyFlowId ?? null,
        scheduled: true,
        elapsedMs: Math.round(performance.now() - streamStartedAt),
        totalElapsedMs: elapsedMs(startedAt),
      });
    };
    if (!currentSlot?.transcriptHydrated) {
      const hydrateStartedAt = startLatencyTimer();
      const selectionNonce = useHarnessStore.getState().workspaceSelectionNonce;
      const afterSeq = currentSlot?.transcript.lastSeq ?? 0;
      const isStillSelected = () => {
        if (guard && !isSessionActivationCurrent(guard)) {
          return false;
        }
        const state = useHarnessStore.getState();
        return state.workspaceSelectionNonce === selectionNonce
          && state.activeSessionId === sessionId
          && state.selectedWorkspaceId === workspaceId;
      };
      streamConnectDeferredUntilHydrate = true;
      useHarnessStore.getState().patchSessionSlot(sessionId, { transcriptHydrated: true });
      recordMeasurementWorkflowStep({
        operationId: measurementOperationId,
        step: "session.select.history_hydrate",
        startedAt: hydrateStartedAt,
        outcome: "completed",
      });
      logLatency("session.select.history_hydrate_deferred", {
        sessionId,
        workspaceId,
        afterSeq,
        flowId: options?.latencyFlowId ?? null,
        totalElapsedMs: elapsedMs(startedAt),
      });
      scheduleAfterNextPaint(() => {
        if (!isStillSelected()) {
          return;
        }
        void rehydrateSessionSlotFromHistory(sessionId, {
          afterSeq,
          limit: INITIAL_SESSION_HISTORY_EVENT_BUDGET,
          requestHeaders,
          isCurrent: isStillSelected,
        }).then((hydrated) => {
          logLatency("session.select.history_hydrated", {
            sessionId,
            workspaceId,
            hydrated,
            flowId: options?.latencyFlowId ?? null,
            elapsedMs: elapsedMs(hydrateStartedAt),
            totalElapsedMs: elapsedMs(startedAt),
          });
        }).finally(() => {
          if (isStillSelected()) {
            scheduleStreamConnect();
          }
        });
      });
      logLatency("session.select.full_history_backfill_skipped", {
        sessionId,
        workspaceId,
        hydrated: true,
        reason: "protect_interactivity",
        flowId: options?.latencyFlowId ?? null,
      });
    }

    if (!streamConnectDeferredUntilHydrate) {
      scheduleStreamConnect();
    }
    logLatency("session.select.completed", {
      sessionId,
      workspaceId,
      flowId: options?.latencyFlowId ?? null,
      totalElapsedMs: elapsedMs(startedAt),
    });
    if (measurementOperationId) {
      markOperationForNextCommit(measurementOperationId, [
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
        activeSessionVersion: useHarnessStore.getState().activeSessionVersion,
      };
    }
  }, [
    activateSession,
    ensureSessionStreamConnected,
    ensureWorkspaceSessions,
    getWorkspaceRuntimeBlockReason,
    rehydrateSessionSlotFromHistory,
  ]);

  const dismissSession = useCallback(async (sessionId: string) => {
    const state = useHarnessStore.getState();
    const closingSlot = state.sessionSlots[sessionId] ?? null;
    const workspaceId = closingSlot?.workspaceId ?? state.selectedWorkspaceId;

    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      showToast(blockedReason);
      return;
    }

    try {
      const { connection } = await getSessionClientAndWorkspace(sessionId);
      await getAnyHarnessClient(connection).sessions.dismiss(sessionId);
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
    const workspaceId = useHarnessStore.getState().selectedWorkspaceId;
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
