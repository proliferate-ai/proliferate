import {
  createTranscriptState,
  type Session,
  type SessionStreamHandle,
} from "@anyharness/sdk";
import { useCallback } from "react";
import {
  fetchSessionSummary,
  getSessionClientAndWorkspace,
  openSessionStream,
  resumeSession,
  type FlushAwareSessionStreamHandle,
} from "@/lib/workflows/sessions/session-runtime";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import {
  finishOrCancelMeasurementOperation,
  recordMeasurementMetric,
  recordMeasurementWorkflowStep,
  startMeasurementOperation,
} from "@/lib/infra/measurement/debug-measurement";
import { logDevSessionRuntimeEvent } from "@/lib/infra/debug/session-runtime-dev-sse";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import { markLatencyFlowLiveAttached } from "@/lib/infra/measurement/latency-flow";
import {
  resolveSessionViewState,
  resolveSessionStatus,
  shouldSkipColdIdleSessionStream,
} from "@proliferate/product-domain/sessions/activity";
import { activitySnapshotFromDirectoryEntry } from "@/lib/domain/sessions/directory/directory-activity";
import {
  clearSessionReconnectTimer,
  scheduleSessionReconnectTimer,
} from "@/lib/workflows/sessions/session-reconnect-state";
import { rememberLastViewedSession } from "@/stores/preferences/workspace-ui-store";
import { resolveWorkspaceUiKey } from "@/lib/domain/workspaces/selection/workspace-ui-key";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  isCurrentStreamHandle,
  shouldReconnectStream,
} from "@/hooks/sessions/lifecycle/session-runtime-helpers";
import { useLinkedSessionMounting } from "@/hooks/chat/workflows/subagents/use-linked-session-mounting";
import {
  useSessionStreamFlushControllerFactory,
  type SessionStreamFlushController,
} from "@/hooks/sessions/lifecycle/use-session-stream-flush";
import { useSessionStreamCache } from "@/hooks/sessions/cache/use-session-stream-cache";
import { useSessionHistoryHydration } from "@/hooks/sessions/lifecycle/use-session-history-hydration";
import { useSessionSummaryActions } from "@/hooks/sessions/workflows/use-session-summary-actions";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import {
  getMaterializedSessionId,
  getSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionIngestStore } from "@/stores/sessions/session-ingest-store";
import {
  clearSessionStreamHandle,
  closeSessionStreamHandle,
  setSessionStreamHandle,
} from "@/lib/access/anyharness/session-stream-handles";

const ACTIVE_SUMMARY_REFRESH_DELAY_MS = 8_000;

export function useSessionRuntimeActions() {
  const sessionStreamCache = useSessionStreamCache();
  const showToast = useToastStore((state) => state.show);
  const { mountSubagentChildSession } = useLinkedSessionMounting();
  const {
    applySessionSummary,
    persistReconciledModePreferences,
  } = useSessionSummaryActions();
  const { rehydrateSessionSlotFromHistory } = useSessionHistoryHydration();

  const activateSession = useCallback((sessionId: string | null) => {
    useSessionSelectionStore.getState().setActiveSessionId(sessionId);
    if (!sessionId) {
      return;
    }

    const entry = useSessionDirectoryStore.getState().entriesById[sessionId];
    if (entry?.workspaceId) {
      const selection = useSessionSelectionStore.getState();
      const workspaceUiKey = entry.workspaceId === selection.selectedWorkspaceId
        ? resolveWorkspaceUiKey(
          selection.selectedLogicalWorkspaceId,
          selection.selectedWorkspaceId,
        )
        : entry.workspaceId;
      if (workspaceUiKey) {
        if (entry.materializedSessionId) {
          rememberLastViewedSession(workspaceUiKey, entry.materializedSessionId);
        }
      }
    }
  }, []);

  const refreshSessionSlotMeta = useCallback(async (
    sessionId: string,
    options?: {
      resumeIfActive?: boolean;
      requestHeaders?: HeadersInit;
      measurementOperationId?: MeasurementOperationId | null;
      isCurrent?: () => boolean;
    },
  ): Promise<void> => {
    try {
      if (options?.isCurrent && !options.isCurrent()) {
        return;
      }
      const { workspaceId } = await getSessionClientAndWorkspace(sessionId);
      let session = await fetchSessionSummary(sessionId, {
        requestHeaders: options?.requestHeaders,
        measurementOperationId: options?.measurementOperationId,
      });
      if (options?.isCurrent && !options.isCurrent()) {
        logDevSessionRuntimeEvent(sessionId, "summary_ignored_not_current", {
          phase: session.executionSummary?.phase ?? null,
          status: session.status,
        });
        return;
      }
      const beforeSummarySlot = getSessionRecord(sessionId);
      logDevSessionRuntimeEvent(sessionId, "summary_received", {
        status: session.status,
        phase: session.executionSummary?.phase ?? null,
        pendingInteractionCount: session.executionSummary?.pendingInteractions?.length ?? 0,
        previousStatus: beforeSummarySlot?.status ?? null,
        previousPhase: beforeSummarySlot?.executionSummary?.phase ?? null,
        previousStreamConnectionState: beforeSummarySlot?.streamConnectionState ?? null,
        previousIsStreaming: beforeSummarySlot?.transcript.isStreaming ?? null,
        previousLastSeq: beforeSummarySlot?.transcript.lastSeq ?? null,
        previousTurnCount: beforeSummarySlot?.transcript.turnOrder.length ?? null,
      });
      applySessionSummary(sessionId, session, workspaceId);
      await reconcileHistoryTailAfterSettledSummary(
        sessionId,
        session,
        beforeSummarySlot,
        {
          requestHeaders: options?.requestHeaders,
          measurementOperationId: options?.measurementOperationId,
          isCurrent: options?.isCurrent,
          rehydrateSessionSlotFromHistory,
        },
      );

      if (
        options?.resumeIfActive
        && resolveSessionStatus(session.status, {
          executionSummary: session.executionSummary ?? null,
          transcript: createTranscriptState(sessionId),
        }) === "running"
      ) {
        session = await resumeSession(sessionId, {
          requestHeaders: options?.requestHeaders,
          measurementOperationId: options?.measurementOperationId,
        });
        if (options?.isCurrent && !options.isCurrent()) {
          logDevSessionRuntimeEvent(sessionId, "resume_summary_ignored_not_current", {
            phase: session.executionSummary?.phase ?? null,
            status: session.status,
          });
          return;
        }
        const beforeResumeSummarySlot = getSessionRecord(sessionId);
        logDevSessionRuntimeEvent(sessionId, "resume_summary_received", {
          status: session.status,
          phase: session.executionSummary?.phase ?? null,
          pendingInteractionCount: session.executionSummary?.pendingInteractions?.length ?? 0,
          previousStatus: beforeResumeSummarySlot?.status ?? null,
          previousPhase: beforeResumeSummarySlot?.executionSummary?.phase ?? null,
          previousStreamConnectionState: beforeResumeSummarySlot?.streamConnectionState ?? null,
          previousIsStreaming: beforeResumeSummarySlot?.transcript.isStreaming ?? null,
          previousLastSeq: beforeResumeSummarySlot?.transcript.lastSeq ?? null,
          previousTurnCount: beforeResumeSummarySlot?.transcript.turnOrder.length ?? null,
        });
        applySessionSummary(sessionId, session, workspaceId);
        await reconcileHistoryTailAfterSettledSummary(
          sessionId,
          session,
          beforeResumeSummarySlot,
          {
            requestHeaders: options?.requestHeaders,
            measurementOperationId: options?.measurementOperationId,
            isCurrent: options?.isCurrent,
            rehydrateSessionSlotFromHistory,
          },
        );
      }
    } catch (error) {
      logDevSessionRuntimeEvent(sessionId, "summary_refresh_failed", {
        errorName: error instanceof Error ? error.name : "unknown",
        message: error instanceof Error ? error.message : String(error),
      });
      if (import.meta.env.DEV) {
        console.debug("[session-runtime] session metadata refresh failed", error);
      }
    }
  }, [applySessionSummary, rehydrateSessionSlotFromHistory]);

  const createSessionStreamFlushController = useSessionStreamFlushControllerFactory({
    sessionStreamCache,
    mountSubagentChildSession,
    persistReconciledModePreferences,
    refreshSessionSlotMeta,
    rehydrateSessionSlotFromHistory,
    showToast,
  });

  const closeSessionSlotStream = useCallback((sessionId: string) => {
    clearSessionReconnectTimer(sessionId);
    const materializedSessionId = getMaterializedSessionId(sessionId);
    const closed = materializedSessionId
      ? closeSessionStreamHandle(materializedSessionId)
      : false;
    if (closed || getSessionRecord(sessionId)) {
      useSessionDirectoryStore.getState().patchEntry(sessionId, {
        streamConnectionState: "disconnected",
      });
    }
  }, []);

  const ensureSessionStreamConnected = useCallback(async (
    sessionId: string,
    options?: {
      awaitOpen?: boolean;
      openTimeoutMs?: number;
      resumeIfActive?: boolean;
      allowColdIdleNoStream?: boolean;
      hydrateBeforeStream?: boolean;
      skipInitialRefresh?: boolean;
      refreshOnStartupReady?: boolean;
      forceReconnect?: boolean;
      reconnectOwner?: "internal" | "external";
      onReconnectNeeded?: () => void;
      requestHeaders?: HeadersInit;
      measurementOperationId?: MeasurementOperationId | null;
      isCurrent?: () => boolean;
    },
  ): Promise<void> => {
    if (options?.isCurrent && !options.isCurrent()) {
      return;
    }
    const initialSlot = getSessionRecord(sessionId);
    if (!initialSlot) {
      return;
    }

    // Defensive: enforce the invariant "if a stream is connecting/open, the
    // transcript is hydrated." selectSession is meant to hydrate before
    // calling here, but several other paths reach this function without
    // hydrating (findOrCreateSession → promptSession, the reconnect path,
    // selectSession's reused-live-slot early-return). Without this check,
    // an unhydrated live slot leaves useChatSurfaceState stuck at
    // session-loading + substep "loading-history" forever. We always patch
    // transcriptHydrated:true even on rehydrate failure, mirroring
    // selectSession's behavior so the gate clears either way.
    if (!initialSlot.transcriptHydrated && options?.hydrateBeforeStream !== false) {
      const hydrateStartedAt = performance.now();
      await rehydrateSessionSlotFromHistory(sessionId, {
        requestHeaders: options?.requestHeaders,
        measurementOperationId: options?.measurementOperationId,
        isCurrent: options?.isCurrent,
      });
      if (options?.isCurrent && !options.isCurrent()) {
        return;
      }
      useSessionDirectoryStore.getState().patchEntry(sessionId, {
        transcriptHydrated: true,
      });
      recordMeasurementWorkflowStep({
        operationId: options?.measurementOperationId,
        step: "session.stream.initial_history_hydrate",
        startedAt: hydrateStartedAt,
      });
    } else if (!initialSlot.transcriptHydrated) {
      recordMeasurementWorkflowStep({
        operationId: options?.measurementOperationId,
        step: "session.stream.initial_history_hydrate",
        startedAt: performance.now(),
        outcome: "skipped",
      });
    }

    const slot = getSessionRecord(sessionId);
    if (!slot) {
      return;
    }

    if (
      !options?.forceReconnect
      && (
        slot.streamConnectionState === "connecting"
        || slot.streamConnectionState === "open"
      )
    ) {
      return;
    }

    if (!options?.skipInitialRefresh) {
      const refreshStartedAt = performance.now();
      await refreshSessionSlotMeta(sessionId, {
        resumeIfActive: options?.resumeIfActive ?? true,
        requestHeaders: options?.requestHeaders,
        measurementOperationId: options?.measurementOperationId,
        isCurrent: options?.isCurrent,
      });
      if (options?.isCurrent && !options.isCurrent()) {
        return;
      }
      recordMeasurementWorkflowStep({
        operationId: options?.measurementOperationId,
        step: "session.stream.initial_refresh",
        startedAt: refreshStartedAt,
      });
    }

    const refreshedSlot = getSessionRecord(sessionId);
    if (options?.isCurrent && !options.isCurrent()) {
      return;
    }
    if (shouldSkipColdIdleSessionStream(refreshedSlot, options?.allowColdIdleNoStream)) {
      recordMeasurementMetric({
        type: "workflow",
        operationId: options?.measurementOperationId ?? undefined,
        step: "session.stream.skip_cold_idle",
        durationMs: 0,
        outcome: "skipped",
      });
      return;
    }

    closeSessionSlotStream(sessionId);
    if (options?.isCurrent && !options.isCurrent()) {
      return;
    }

    const currentSlot = getSessionRecord(sessionId);
    const afterSeq = currentSlot?.transcript.lastSeq ?? 0;
    const connectStartedAt = performance.now();
    const standaloneStreamMeasurementOperationId = startMeasurementOperation({
      kind: "session_stream_sample",
      sampleKey: "stream",
      surfaces: [
        "session-transcript-pane",
        "transcript-list",
        "header-tabs",
        "workspace-sidebar",
        "global-header",
        "chat-composer-dock",
      ],
      maxDurationMs: 30_000,
    });
    const streamMeasurementOperationId = standaloneStreamMeasurementOperationId;
    let handle: SessionStreamHandle | null = null;
    const isStillCurrent = () => !options?.isCurrent || options.isCurrent();

    let openResolved = false;
    let resolveOpen: (() => void) | null = null;
    let startupReadyRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    let activeSummaryRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    let startupReadyRefreshStarted = false;
    let streamConnectMeasurementFinished = false;
    let suppressNextCloseReconnect = false;
    const openPromise = new Promise<void>((resolve) => {
      resolveOpen = () => {
        if (openResolved) {
          return;
        }
        openResolved = true;
        resolve();
      };
    });
    const finishStreamConnectMeasurement = (reason: "completed" | "aborted") => {
      if (streamConnectMeasurementFinished) {
        return;
      }
      streamConnectMeasurementFinished = true;
      finishOrCancelMeasurementOperation(
        standaloneStreamMeasurementOperationId,
        reason,
      );
    };

    const scheduleStartupReadyRefresh = (
      reason: "stream_open" | "available_commands",
      delayMs: number,
    ) => {
      if (!options?.refreshOnStartupReady || startupReadyRefreshStarted) {
        return;
      }
      if (startupReadyRefreshTimer) {
        clearTimeout(startupReadyRefreshTimer);
      }
      startupReadyRefreshTimer = setTimeout(() => {
        startupReadyRefreshTimer = null;
        if (startupReadyRefreshStarted) {
          return;
        }
        startupReadyRefreshStarted = true;
        const refreshStartedAt = performance.now();
        void refreshSessionSlotMeta(sessionId, {
          resumeIfActive: false,
          requestHeaders: options?.requestHeaders,
          measurementOperationId: streamMeasurementOperationId,
          isCurrent: options?.isCurrent,
        }).then(() => {
          logLatency("session.stream.startup_meta_refreshed", {
            sessionId,
            reason,
            elapsedMs: Math.round(performance.now() - refreshStartedAt),
          });
        }).catch(() => {
          logLatency("session.stream.startup_meta_refresh_failed", {
            sessionId,
            reason,
            elapsedMs: Math.round(performance.now() - refreshStartedAt),
          });
        });
      }, delayMs);
    };
    const clearStartupReadyRefreshTimer = () => {
      if (!startupReadyRefreshTimer) {
        return;
      }
      clearTimeout(startupReadyRefreshTimer);
      startupReadyRefreshTimer = null;
    };
    const clearActiveSummaryRefreshTimer = () => {
      if (!activeSummaryRefreshTimer) {
        return;
      }
      clearTimeout(activeSummaryRefreshTimer);
      activeSummaryRefreshTimer = null;
    };
    const shouldRefreshActiveSummary = () => {
      if (!isStillCurrent()) {
        return false;
      }
      const latestEntry = useSessionDirectoryStore.getState().entriesById[sessionId] ?? null;
      return resolveSessionViewState(activitySnapshotFromDirectoryEntry(latestEntry)) === "working";
    };
    const scheduleActiveSummaryRefresh = () => {
      clearActiveSummaryRefreshTimer();
      if (!shouldRefreshActiveSummary()) {
        return;
      }

      activeSummaryRefreshTimer = setTimeout(() => {
        activeSummaryRefreshTimer = null;
        const materializedSessionId = getMaterializedSessionId(sessionId);
        if (!handle || !materializedSessionId || !isCurrentStreamHandle(materializedSessionId, handle)) {
          return;
        }
        if (!shouldRefreshActiveSummary()) {
          return;
        }

        const refreshStartedAt = performance.now();
        void refreshSessionSlotMeta(sessionId, {
          resumeIfActive: false,
          requestHeaders: options?.requestHeaders,
          measurementOperationId: streamMeasurementOperationId,
          isCurrent: options?.isCurrent,
        }).then(() => {
          logLatency("session.stream.active_meta_refreshed", {
            sessionId,
            elapsedMs: Math.round(performance.now() - refreshStartedAt),
          });
        }).catch(() => {
          logLatency("session.stream.active_meta_refresh_failed", {
            sessionId,
            elapsedMs: Math.round(performance.now() - refreshStartedAt),
          });
        }).finally(() => {
          const materializedSessionId = getMaterializedSessionId(sessionId);
          if (
            handle
            && materializedSessionId
            && isCurrentStreamHandle(materializedSessionId, handle)
            && shouldRefreshActiveSummary()
          ) {
            scheduleActiveSummaryRefresh();
          }
        });
      }, ACTIVE_SUMMARY_REFRESH_DELAY_MS);
    };

    const scheduleReconnect = (delayMs = 350) => {
      clearSessionReconnectTimer(sessionId);
      if (!isStillCurrent() || !shouldReconnectStream(sessionId)) {
        return;
      }
      if (options?.reconnectOwner === "external") {
        options.onReconnectNeeded?.();
        return;
      }

      scheduleSessionReconnectTimer(sessionId, () => {
        if (!isStillCurrent() || !shouldReconnectStream(sessionId)) {
          return;
        }

        void refreshSessionSlotMeta(sessionId, {
          resumeIfActive: true,
          isCurrent: options?.isCurrent,
        })
          .finally(() => {
            if (isStillCurrent()) {
              void ensureSessionStreamConnected(sessionId, {
                isCurrent: options?.isCurrent,
              });
            }
          });
      }, delayMs);
    };
    const streamFlushController = createSessionStreamFlushController({
      sessionId,
      streamMeasurementOperationId,
      requestHeaders: options?.requestHeaders,
      isStillCurrent,
      isCurrentStream: () => {
        const materializedSessionId = getMaterializedSessionId(sessionId);
        return !!handle
          && !!materializedSessionId
          && isCurrentStreamHandle(materializedSessionId, handle);
      },
      closeCurrentHandle: () => {
        suppressNextCloseReconnect = true;
        handle?.close();
      },
      scheduleReconnect,
      clearActiveSummaryRefreshTimer,
      scheduleActiveSummaryRefresh,
      scheduleStartupReadyRefresh,
    });

    await openSessionStream(sessionId, {
      afterSeq,
      requestHeaders: options?.requestHeaders,
      measurementOperationId: streamMeasurementOperationId ?? undefined,
      onHandle: (nextHandle) => {
        if (!isStillCurrent()) {
          logDevSessionRuntimeEvent(sessionId, "stream_handle_ignored_not_current", {});
          nextHandle.close();
          return;
        }
        const flushAwareHandle = createFlushAwareSessionStreamHandle(
          nextHandle,
          streamFlushController,
        );
        handle = flushAwareHandle;
        const materializedSessionId = getMaterializedSessionId(sessionId);
        if (!materializedSessionId) {
          logDevSessionRuntimeEvent(sessionId, "stream_handle_closed_missing_materialized_id", {});
          nextHandle.close();
          return;
        }
        setSessionStreamHandle({
          sessionId: materializedSessionId,
          workspaceId: currentSlot?.workspaceId ?? null,
          runtimeUrl: useHarnessConnectionStore.getState().runtimeUrl,
          handle: flushAwareHandle,
        });
        useSessionDirectoryStore.getState().patchEntry(sessionId, {
          streamConnectionState: "connecting",
        });
        logDevSessionRuntimeEvent(sessionId, "stream_handle_registered", {
          materializedSessionId,
          afterSeq,
        });
      },
      onOpen: () => {
        const materializedSessionId = getMaterializedSessionId(sessionId);
        if (!isStillCurrent() || !handle || !materializedSessionId || !isCurrentStreamHandle(materializedSessionId, handle)) {
          logDevSessionRuntimeEvent(sessionId, "stream_open_ignored", {
            hasHandle: !!handle,
            materializedSessionId,
            stillCurrent: isStillCurrent(),
          });
          return;
        }
        useSessionDirectoryStore.getState().patchEntry(sessionId, {
          streamConnectionState: "open",
        });
        useSessionIngestStore.getState().markCurrentIfContiguous(
          sessionId,
          getSessionRecord(sessionId)?.transcript.lastSeq ?? 0,
        );
        markLatencyFlowLiveAttached(sessionId);
        logLatency("session.stream.open", {
          sessionId,
          elapsedMs: Math.round(performance.now() - connectStartedAt),
        });
        logDevSessionRuntimeEvent(sessionId, "stream_open", {
          materializedSessionId,
          afterSeq,
          currentLastSeq: getSessionRecord(sessionId)?.transcript.lastSeq ?? null,
        });
        recordMeasurementWorkflowStep({
          operationId: streamMeasurementOperationId,
          step: "session.stream.open",
          startedAt: connectStartedAt,
        });
        scheduleStartupReadyRefresh("stream_open", 3500);
        resolveOpen?.();
        finishStreamConnectMeasurement("completed");
      },
      onEvent: (envelope) => {
        const materializedSessionId = getMaterializedSessionId(sessionId);
        if (!isStillCurrent() || !handle || !materializedSessionId || !isCurrentStreamHandle(materializedSessionId, handle)) {
          logDevSessionRuntimeEvent(sessionId, "stream_event_ignored", {
            seq: envelope.seq,
            eventType: envelope.event.type,
            hasHandle: !!handle,
            materializedSessionId,
            stillCurrent: isStillCurrent(),
          });
          return;
        }
        logDevSessionRuntimeEvent(sessionId, "stream_event_enqueued", {
          seq: envelope.seq,
          eventType: envelope.event.type,
          turnId: envelope.turnId ?? null,
          itemId: envelope.itemId ?? null,
          currentLastSeq: getSessionRecord(sessionId)?.transcript.lastSeq ?? null,
        });
        streamFlushController.enqueue(envelope);
      },
      onError: () => {
        logDevSessionRuntimeEvent(sessionId, "stream_error", {
          currentLastSeq: getSessionRecord(sessionId)?.transcript.lastSeq ?? null,
        });
        streamFlushController.flushNow();
        streamFlushController.dispose();
        finishStreamConnectMeasurement("aborted");
        resolveOpen?.();
        clearStartupReadyRefreshTimer();
        clearActiveSummaryRefreshTimer();
        const materializedSessionId = getMaterializedSessionId(sessionId);
        if (!isStillCurrent() || !handle || !materializedSessionId || !isCurrentStreamHandle(materializedSessionId, handle)) {
          logDevSessionRuntimeEvent(sessionId, "stream_error_ignored_after_flush", {
            hasHandle: !!handle,
            materializedSessionId,
            stillCurrent: isStillCurrent(),
          });
          return;
        }
        clearSessionStreamHandle(materializedSessionId, handle);
        useSessionDirectoryStore.getState().patchEntry(sessionId, {
          streamConnectionState: "disconnected",
        });
        useSessionIngestStore.getState().markStale(sessionId, {
          lastAppliedSeq: getSessionRecord(sessionId)?.transcript.lastSeq ?? 0,
          lastObservedSeq: getSessionRecord(sessionId)?.transcript.lastSeq ?? 0,
          gapAfterSeq: null,
          lastErrorAt: new Date().toISOString(),
        });
        scheduleReconnect();
      },
      onClose: () => {
        logDevSessionRuntimeEvent(sessionId, "stream_close", {
          currentLastSeq: getSessionRecord(sessionId)?.transcript.lastSeq ?? null,
        });
        streamFlushController.flushNow();
        streamFlushController.dispose();
        finishStreamConnectMeasurement(openResolved ? "completed" : "aborted");
        resolveOpen?.();
        clearStartupReadyRefreshTimer();
        clearActiveSummaryRefreshTimer();
        const materializedSessionId = getMaterializedSessionId(sessionId);
        if (!isStillCurrent() || !handle || !materializedSessionId || !isCurrentStreamHandle(materializedSessionId, handle)) {
          logDevSessionRuntimeEvent(sessionId, "stream_close_ignored_after_flush", {
            hasHandle: !!handle,
            materializedSessionId,
            stillCurrent: isStillCurrent(),
          });
          return;
        }

        clearSessionStreamHandle(materializedSessionId, handle);
        if (suppressNextCloseReconnect) {
          suppressNextCloseReconnect = false;
          return;
        }
        useSessionDirectoryStore.getState().patchEntry(sessionId, {
          streamConnectionState: "ended",
        });
        if (shouldReconnectStream(sessionId)) {
          useSessionIngestStore.getState().markStale(sessionId, {
            lastAppliedSeq: getSessionRecord(sessionId)?.transcript.lastSeq ?? 0,
            lastObservedSeq: getSessionRecord(sessionId)?.transcript.lastSeq ?? 0,
            gapAfterSeq: null,
            lastErrorAt: new Date().toISOString(),
          });
          scheduleReconnect();
        }
      },
    });
    if (!isStillCurrent()) {
      return;
    }
    recordMeasurementWorkflowStep({
      operationId: streamMeasurementOperationId,
      step: "session.stream.open_handle",
      startedAt: connectStartedAt,
    });
    recordMeasurementWorkflowStep({
      operationId: options?.measurementOperationId,
      step: "session.stream.open_handle",
      startedAt: connectStartedAt,
    });

    if (!options?.awaitOpen) {
      return;
    }

    await Promise.race([
      openPromise,
      new Promise<void>((resolve) => {
        setTimeout(resolve, options?.openTimeoutMs ?? 2500);
      }),
    ]);
  }, [
    closeSessionSlotStream,
    createSessionStreamFlushController,
    refreshSessionSlotMeta,
    rehydrateSessionSlotFromHistory,
  ]);

  return {
    activateSession,
    applySessionSummary,
    closeSessionSlotStream,
    ensureSessionStreamConnected,
    rehydrateSessionSlotFromHistory,
    refreshSessionSlotMeta,
  };
}

function createFlushAwareSessionStreamHandle(
  handle: SessionStreamHandle,
  streamFlushController: SessionStreamFlushController,
): FlushAwareSessionStreamHandle {
  let closed = false;

  return {
    close() {
      streamFlushController.flushNow();
      streamFlushController.dispose();
      if (closed) {
        return;
      }
      closed = true;
      handle.close();
    },
    flushPendingEvents() {
      streamFlushController.flushNow();
    },
  };
}

async function reconcileHistoryTailAfterSettledSummary(
  sessionId: string,
  session: Session,
  previousSlot: ReturnType<typeof getSessionRecord>,
  options: {
    requestHeaders?: HeadersInit;
    measurementOperationId?: MeasurementOperationId | null;
    isCurrent?: () => boolean;
    rehydrateSessionSlotFromHistory: (
      sessionId: string,
      options?: {
        afterSeq?: number;
        requestHeaders?: HeadersInit;
        measurementOperationId?: MeasurementOperationId | null;
        timeoutMs?: number;
        isCurrent?: () => boolean;
      },
    ) => Promise<boolean>;
  },
): Promise<void> {
  if (!previousSlot) {
    logDevSessionRuntimeEvent(sessionId, "history_tail_reconcile_skipped", {
      reason: "missing_previous_slot",
      summaryStatus: session.status,
      summaryPhase: session.executionSummary?.phase ?? null,
    });
    return;
  }
  if (sessionSummaryIsActive(session)) {
    logDevSessionRuntimeEvent(sessionId, "history_tail_reconcile_skipped", {
      reason: "summary_active",
      summaryStatus: session.status,
      summaryPhase: session.executionSummary?.phase ?? null,
      previousStatus: previousSlot.status,
      previousPhase: previousSlot.executionSummary?.phase ?? null,
      previousIsStreaming: previousSlot.transcript.isStreaming,
      previousLastSeq: previousSlot.transcript.lastSeq,
    });
    return;
  }
  if (!slotLooksLocallyActive(previousSlot)) {
    logDevSessionRuntimeEvent(sessionId, "history_tail_reconcile_skipped", {
      reason: "local_not_active",
      summaryStatus: session.status,
      summaryPhase: session.executionSummary?.phase ?? null,
      previousStatus: previousSlot.status,
      previousPhase: previousSlot.executionSummary?.phase ?? null,
      previousIsStreaming: previousSlot.transcript.isStreaming,
      previousLastSeq: previousSlot.transcript.lastSeq,
    });
    return;
  }

  logDevSessionRuntimeEvent(sessionId, "history_tail_reconcile_started", {
    afterSeq: previousSlot.transcript.lastSeq,
    summaryStatus: session.status,
    summaryPhase: session.executionSummary?.phase ?? null,
    previousStatus: previousSlot.status,
    previousPhase: previousSlot.executionSummary?.phase ?? null,
    previousIsStreaming: previousSlot.transcript.isStreaming,
  });
  const applied = await options.rehydrateSessionSlotFromHistory(sessionId, {
    afterSeq: previousSlot.transcript.lastSeq,
    requestHeaders: options.requestHeaders,
    measurementOperationId: options.measurementOperationId,
    timeoutMs: 5_000,
    isCurrent: options.isCurrent,
  });
  const afterSlot = getSessionRecord(sessionId);
  logDevSessionRuntimeEvent(sessionId, "history_tail_reconcile_finished", {
    applied,
    afterStatus: afterSlot?.status ?? null,
    afterPhase: afterSlot?.executionSummary?.phase ?? null,
    afterIsStreaming: afterSlot?.transcript.isStreaming ?? null,
    afterLastSeq: afterSlot?.transcript.lastSeq ?? null,
    afterTurnCount: afterSlot?.transcript.turnOrder.length ?? null,
  });
}

function sessionSummaryIsActive(session: Session): boolean {
  const phase = session.executionSummary?.phase ?? null;
  return session.status === "starting"
    || session.status === "running"
    || phase === "starting"
    || phase === "running"
    || phase === "awaiting_interaction";
}

function slotLooksLocallyActive(slot: NonNullable<ReturnType<typeof getSessionRecord>>): boolean {
  const phase = slot.executionSummary?.phase ?? null;
  return slot.transcript.isStreaming
    || slot.status === "starting"
    || slot.status === "running"
    || phase === "starting"
    || phase === "running"
    || phase === "awaiting_interaction";
}
