import type {
  SessionEventEnvelope,
  TranscriptState,
} from "@anyharness/sdk";
import { useCallback } from "react";
import {
  createFrameStreamBatchScheduler,
  type StreamBatchScheduler,
} from "@proliferate/product-domain/chats/transcript/stream-batcher";
import { applyStreamEnvelopeBatch } from "@/lib/domain/sessions/stream/stream-state";
import {
  logDevSSEEvent,
  logDevSessionRuntimeEvent,
} from "@/lib/infra/debug/session-runtime-dev-sse";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import {
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  recordMeasurementMetric,
  startMeasurementOperation,
} from "@/lib/infra/measurement/debug-measurement";
import type {
  MeasurementOperationId,
  MeasurementSurface,
} from "@/lib/domain/telemetry/debug-measurement-catalog";
import { uniqueMeasurementOperationIds } from "@/lib/infra/measurement/operation-ids";
import type {
  SessionChildRelationship,
  SessionRelationship,
} from "@/lib/domain/sessions/directory/relationship";
import { markWorkspaceViewedAt } from "@/stores/preferences/workspace-ui-store";
import { isDocumentVisibleAndFocused } from "@/hooks/ui/document/use-document-focus-visibility";
import {
  pendingConfigChangesForSessionIntents,
} from "@proliferate/product-domain/sessions/intents/session-intent-selectors";
import {
  sessionIntentsForSession,
} from "@proliferate/product-domain/sessions/intents/session-intent-state";
import {
  reconcilePendingConfigChanges,
  type PendingSessionConfigChange,
  type PendingSessionConfigChanges,
} from "@proliferate/product-domain/sessions/pending-config";
import { buildSessionStreamBatchPatch } from "@/lib/domain/sessions/stream-patch";
import {
  pruneEchoedOutboxTombstonesForTranscript,
  reconcileOutboxFromEnvelopes,
} from "@proliferate/product-domain/sessions/intents/session-intent-reconciliation";
import { shouldClearOptimisticPendingPromptForEnvelope } from "@proliferate/product-domain/chats/pending-prompts/pending-prompts";
import {
  applyBatchedStreamSideEffects,
} from "@/hooks/sessions/lifecycle/session-stream-side-effects";
import {
  createLatestTimestampThrottle,
} from "@/lib/domain/sessions/stream/latest-timestamp-throttle";
import type { ReconciledStreamConfigIntent } from "@/lib/domain/sessions/stream/stream-side-effect-plan";
import type { SessionStreamCache } from "@/hooks/sessions/cache/use-session-stream-cache";
import { batchSessionStoreWrites } from "@/lib/infra/scheduling/react-batching";
import { activityFromTranscript } from "@/lib/domain/sessions/directory/directory-activity";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { getSessionRecord } from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionIngestStore } from "@/stores/sessions/session-ingest-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";

const SESSION_STREAM_EVENT_BATCH_IDLE_MS = 350;
const SESSION_STREAM_EVENT_BATCH_MAX_DURATION_MS = 5_000;
const SESSION_STREAM_FLUSH_MAX_PAINT_WAIT_MS = 50;
const SESSION_STREAM_FLUSH_WATCHDOG_MS = 250;
const STREAM_WORKSPACE_VIEWED_WRITE_INTERVAL_MS = 1_000;
const SESSION_APPLY_MEASUREMENT_SURFACES: readonly MeasurementSurface[] = [
  "session-transcript-pane",
  "transcript-list",
  "chat-surface",
  "header-tabs",
  "workspace-sidebar",
  "global-header",
  "chat-composer-dock",
];

const streamWorkspaceViewedThrottle = createLatestTimestampThrottle({
  intervalMs: STREAM_WORKSPACE_VIEWED_WRITE_INTERVAL_MS,
  write: markWorkspaceViewedAt,
});

export interface SessionStreamFlushController {
  enqueue(envelope: SessionEventEnvelope): void;
  flushNow(): void;
  dispose(): void;
}

interface SessionStreamFlushFactoryDeps {
  sessionStreamCache: SessionStreamCache;
  mountSubagentChildSession: (input: {
    childSessionId: string;
    label: string | null;
    workspaceId: string | null;
    parentSessionId: string | null;
    sessionLinkId?: string | null;
    requestHeaders?: HeadersInit;
  }) => Promise<void> | void;
  persistReconciledModePreferences: (
    workspaceId: string | null | undefined,
    agentKind: string | null | undefined,
    liveConfigRawConfigId: string | null | undefined,
    reconciledChanges: PendingSessionConfigChange[],
    liveConfigValueResolver: (rawConfigId: string) => string | null,
  ) => void;
  refreshSessionSlotMeta: (
    sessionId: string,
    options?: {
      resumeIfActive?: boolean;
      requestHeaders?: HeadersInit;
      measurementOperationId?: MeasurementOperationId | null;
      isCurrent?: () => boolean;
    },
  ) => Promise<void>;
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
  showToast: (message: string, type?: "error" | "info") => void;
  scheduler?: SessionStreamFlushScheduler;
}

interface SessionStreamFlushControllerOptions {
  sessionId: string;
  streamMeasurementOperationId: MeasurementOperationId | null;
  requestHeaders?: HeadersInit;
  isStillCurrent: () => boolean;
  isCurrentStream: () => boolean;
  closeCurrentHandle: () => void;
  scheduleReconnect: (delayMs?: number) => void;
  clearActiveSummaryRefreshTimer: () => void;
  scheduleActiveSummaryRefresh: () => void;
  scheduleStartupReadyRefresh: (
    reason: "stream_open" | "available_commands",
    delayMs: number,
  ) => void;
}

interface BatchConfigReconcileResult {
  pendingConfigChanges: PendingSessionConfigChanges;
  reconciledIntents: ReconciledStreamConfigIntent[];
}

export type SessionStreamFlushScheduler = StreamBatchScheduler;

export const animationFrameSessionStreamFlushScheduler: SessionStreamFlushScheduler = {
  schedule(callback) {
    return createFrameStreamBatchScheduler({
      requestAnimationFrame: typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : undefined,
      cancelAnimationFrame: typeof cancelAnimationFrame === "function"
        ? cancelAnimationFrame
        : undefined,
      setTimeout,
      clearTimeout: (handle) => {
        clearTimeout(handle as Parameters<typeof clearTimeout>[0]);
      },
      maxPaintWaitMs: SESSION_STREAM_FLUSH_MAX_PAINT_WAIT_MS,
    }).schedule(callback);
  },
};

export function useSessionStreamFlushControllerFactory({
  sessionStreamCache,
  mountSubagentChildSession,
  persistReconciledModePreferences,
  refreshSessionSlotMeta,
  rehydrateSessionSlotFromHistory,
  showToast,
  scheduler = animationFrameSessionStreamFlushScheduler,
}: SessionStreamFlushFactoryDeps) {
  return useCallback((options: SessionStreamFlushControllerOptions) =>
    createSessionStreamFlushController({
      ...options,
      sessionStreamCache,
      mountSubagentChildSession,
      persistReconciledModePreferences,
      refreshSessionSlotMeta,
      rehydrateSessionSlotFromHistory,
      showToast,
      scheduler,
    }), [
    mountSubagentChildSession,
    persistReconciledModePreferences,
    refreshSessionSlotMeta,
    rehydrateSessionSlotFromHistory,
    scheduler,
    sessionStreamCache,
    showToast,
  ]);
}

export function createSessionStreamFlushController(
  input: SessionStreamFlushControllerOptions & SessionStreamFlushFactoryDeps,
): SessionStreamFlushController {
  const scheduler = input.scheduler ?? animationFrameSessionStreamFlushScheduler;
  let queue: SessionEventEnvelope[] = [];
  let cancelScheduledFlush: (() => void) | null = null;
  let flushWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const clearFlushWatchdog = () => {
    if (!flushWatchdogTimer) {
      return;
    }
    clearTimeout(flushWatchdogTimer);
    flushWatchdogTimer = null;
  };

  const scheduleFlushWatchdog = () => {
    if (flushWatchdogTimer || disposed) {
      return;
    }
    flushWatchdogTimer = setTimeout(() => {
      flushWatchdogTimer = null;
      if (cancelScheduledFlush) {
        cancelScheduledFlush();
        cancelScheduledFlush = null;
      }
      logDevSessionRuntimeEvent(input.sessionId, "stream_flush_watchdog_fired", {
        queuedCount: queue.length,
        firstSeq: queue[0]?.seq ?? null,
        lastSeq: queue[queue.length - 1]?.seq ?? null,
      });
      flush();
    }, SESSION_STREAM_FLUSH_WATCHDOG_MS);
  };

  const scheduleFlush = () => {
    if (disposed) {
      return;
    }
    scheduleFlushWatchdog();
    if (cancelScheduledFlush) {
      return;
    }
    cancelScheduledFlush = scheduler.schedule(() => {
      cancelScheduledFlush = null;
      clearFlushWatchdog();
      flush();
    });
  };

  const flush = () => {
    if (disposed || queue.length === 0) {
      clearFlushWatchdog();
      return;
    }
    const envelopes = queue;
    queue = [];
    clearFlushWatchdog();

    const stillCurrent = input.isStillCurrent();
    const currentStream = input.isCurrentStream();
    if (!stillCurrent || !currentStream) {
      logLatency("session.stream.flush.dropped_stale", {
        sessionId: input.sessionId,
        envelopeCount: envelopes.length,
        firstSeq: envelopes[0]?.seq ?? null,
        lastSeq: envelopes[envelopes.length - 1]?.seq ?? null,
        stillCurrent,
        currentStream,
      });
      return;
    }

    const slotState = getSessionRecord(input.sessionId);
    if (!slotState) {
      logDevSessionRuntimeEvent(input.sessionId, "stream_flush_skipped", {
        reason: "missing_slot",
        envelopeCount: envelopes.length,
        firstSeq: envelopes[0]?.seq ?? null,
        lastSeq: envelopes[envelopes.length - 1]?.seq ?? null,
      });
      return;
    }

    logDevSessionRuntimeEvent(input.sessionId, "stream_flush_started", {
      envelopeCount: envelopes.length,
      firstSeq: envelopes[0]?.seq ?? null,
      lastSeq: envelopes[envelopes.length - 1]?.seq ?? null,
      lastSeqBefore: slotState.transcript.lastSeq,
    });

    const streamEventBatchOperationId = startMeasurementOperation({
      kind: "session_stream_event_batch",
      sampleKey: "stream",
      surfaces: SESSION_APPLY_MEASUREMENT_SURFACES,
      idleTimeoutMs: SESSION_STREAM_EVENT_BATCH_IDLE_MS,
      maxDurationMs: SESSION_STREAM_EVENT_BATCH_MAX_DURATION_MS,
    });
    const streamApplyOperationIds = uniqueMeasurementOperationIds([
      input.streamMeasurementOperationId,
      streamEventBatchOperationId,
    ]);
    for (const operationId of streamApplyOperationIds) {
      recordStreamStateCounts(
        operationId,
        "before",
        slotState.events,
        slotState.transcript,
      );
    }

    const reducerStartedAt = performance.now();
    const result = applyStreamEnvelopeBatch(
      {
        events: slotState.events,
        transcript: slotState.transcript,
      },
      envelopes,
    );
    for (const operationId of streamApplyOperationIds) {
      recordMeasurementMetric({
        type: "reducer",
        category: "session.stream",
        operationId,
        durationMs: performance.now() - reducerStartedAt,
        count: envelopes.length,
      });
    }

    for (const envelope of result.duplicateEnvelopes) {
      logDevSSEEvent(input.sessionId, envelope, "duplicate");
    }
    for (const envelope of result.appliedEnvelopes) {
      logDevSSEEvent(input.sessionId, envelope, "applied");
    }
    if (result.gapEnvelope) {
      logDevSSEEvent(input.sessionId, result.gapEnvelope, "gap");
    }

    const lastObservedSeq = maxEnvelopeSeq(envelopes, slotState.transcript.lastSeq);
    logLatency("session.stream.flush.batch", {
      sessionId: input.sessionId,
      envelopeCount: envelopes.length,
      appliedCount: result.appliedEnvelopes.length,
      duplicateCount: result.duplicateEnvelopes.length,
      gapSeq: result.gapEnvelope?.seq ?? null,
      gapType: result.gapEnvelope?.event.type ?? null,
      lastSeqBefore: slotState.transcript.lastSeq,
      lastSeqAfter: result.state.transcript.lastSeq,
      lastObservedSeq,
      streamConnectionState: slotState.streamConnectionState,
      transcriptHydrated: slotState.transcriptHydrated,
    });
    logDevSessionRuntimeEvent(input.sessionId, "stream_flush_reduced", {
      envelopeCount: envelopes.length,
      appliedCount: result.appliedEnvelopes.length,
      duplicateCount: result.duplicateEnvelopes.length,
      gapSeq: result.gapEnvelope?.seq ?? null,
      gapType: result.gapEnvelope?.event.type ?? null,
      lastSeqBefore: slotState.transcript.lastSeq,
      lastSeqAfter: result.state.transcript.lastSeq,
      lastObservedSeq,
    });
    if (result.appliedEnvelopes.length === 0 && !result.gapEnvelope) {
      useSessionIngestStore.getState().applyStreamProgress(input.sessionId, {
        lastAppliedSeq: slotState.transcript.lastSeq,
        lastObservedSeq,
        gapAfterSeq: null,
      });
      finishOrCancelMeasurementOperation(streamEventBatchOperationId, "completed");
      return;
    }

    const intentPendingConfigChanges = pendingConfigChangesForSessionIntents(
      sessionIntentsForSession(useSessionIntentStore.getState(), input.sessionId),
    );
    const configReconcileResult = reconcileBatchPendingConfigChanges(
      result.appliedEnvelopes,
      intentPendingConfigChanges,
    );
    const streamPatch = result.appliedEnvelopes.length > 0
      ? buildSessionStreamBatchPatch({
        slot: slotState,
        nextTranscript: result.state.transcript,
        envelopes: result.appliedEnvelopes,
      })
      : {
        transcript: slotState.transcript,
      };
    const shouldDisconnectForGap = !!result.gapEnvelope;
    const shouldClearOptimisticPrompt = result.appliedEnvelopes.some((envelope) =>
      shouldClearOptimisticPendingPromptForEnvelope(envelope, slotState.optimisticPrompt)
    );

    const storeStartedAt = performance.now();
    batchSessionStoreWrites(() => {
      useSessionTranscriptStore.getState().patchEntry(input.sessionId, {
        events: result.state.events,
        transcript: streamPatch.transcript,
        optimisticPrompt: shouldClearOptimisticPrompt ? null : slotState.optimisticPrompt,
      });
      useSessionIntentStore.setState((state) => {
        const reconciled = reconcileOutboxFromEnvelopes(
          state,
          input.sessionId,
          result.appliedEnvelopes,
        );
        const next = pruneEchoedOutboxTombstonesForTranscript(
          reconciled,
          result.state.transcript,
        );
        if (next === state) {
          return state;
        }
        return {
          ...state,
          ...next,
          dispatchVersion: state.dispatchVersion + 1,
        };
      });
      useSessionDirectoryStore.getState().patchEntry(input.sessionId, {
        liveConfig: streamPatch.liveConfig !== undefined
          ? streamPatch.liveConfig
          : slotState.liveConfig,
        executionSummary: streamPatch.executionSummary !== undefined
          ? streamPatch.executionSummary
          : slotState.executionSummary,
        modelId: streamPatch.modelId !== undefined
          ? streamPatch.modelId
          : slotState.modelId,
        requestedModelId: streamPatch.requestedModelId !== undefined
          ? streamPatch.requestedModelId
          : slotState.requestedModelId,
        modeId: streamPatch.modeId !== undefined
          ? streamPatch.modeId
          : slotState.modeId,
        title: streamPatch.title !== undefined
          ? streamPatch.title
          : slotState.title,
        status: streamPatch.status !== undefined
          ? streamPatch.status
          : slotState.status,
        pendingConfigChanges: {},
        activity: activityFromTranscript(streamPatch.transcript, {
          status: streamPatch.status !== undefined
            ? streamPatch.status
            : slotState.status,
          executionSummary: streamPatch.executionSummary !== undefined
            ? streamPatch.executionSummary
            : slotState.executionSummary,
        }),
        ...(shouldDisconnectForGap
          ? { streamConnectionState: "disconnected" as const }
          : {}),
      });
    });
    for (const operationId of streamApplyOperationIds) {
      recordMeasurementMetric({
        type: "store",
        category: "session.stream",
        operationId,
        durationMs: performance.now() - storeStartedAt,
      });
      recordStreamStateCounts(
        operationId,
        "after",
        result.state.events,
        result.state.transcript,
      );
      markSessionApplyForNextCommit(operationId);
    }
    useSessionIngestStore.getState().applyStreamProgress(input.sessionId, {
      lastAppliedSeq: result.state.transcript.lastSeq,
      lastObservedSeq,
      gapAfterSeq: result.gapEnvelope ? result.state.transcript.lastSeq : null,
    });

    applyBatchedStreamSideEffects({
      ...input,
      runtimeUrl: useHarnessConnectionStore.getState().runtimeUrl,
      workspaceId: slotState.workspaceId,
      agentKind: slotState.agentKind,
      envelopes: result.appliedEnvelopes,
      transcript: result.state.transcript,
      pendingConfigChanges: configReconcileResult.pendingConfigChanges,
      reconciledIntents: configReconcileResult.reconciledIntents,
      recordSessionRelationshipHint: (
        sessionId: string,
        relationship: SessionChildRelationship,
      ) => {
        useSessionDirectoryStore.getState().recordRelationshipHint(sessionId, relationship);
      },
      getSessionRelationship: (sessionId: string): SessionRelationship | null =>
        useSessionDirectoryStore.getState().entriesById[sessionId]?.sessionRelationship ?? null,
      acknowledgeWorkspaceActivity: (workspaceId: string, timestamp: string) => {
        if (!isDocumentVisibleAndFocused()) {
          return;
        }
        const selection = useSessionSelectionStore.getState();
        if (workspaceId !== selection.selectedWorkspaceId) {
          return;
        }
        markWorkspaceViewedAtFromStream(
          selection.selectedLogicalWorkspaceId ?? workspaceId,
          timestamp,
        );
      },
    });

    finishOrCancelMeasurementOperation(streamEventBatchOperationId, "completed");
    logDevSessionRuntimeEvent(input.sessionId, "stream_flush_finished", {
      lastSeqAfter: result.state.transcript.lastSeq,
      queuedCount: queue.length,
      shouldDisconnectForGap,
    });

    if (shouldDisconnectForGap) {
      const afterSeq = result.state.transcript.lastSeq;
      logDevSessionRuntimeEvent(input.sessionId, "stream_gap_reconcile_started", {
        gapSeq: result.gapEnvelope?.seq ?? null,
        gapType: result.gapEnvelope?.event.type ?? null,
        afterSeq,
        skippedAfterGapCount: result.skippedAfterGapEnvelopes.length,
        lastObservedSeq,
      });
      const reconcileHistoryTail = input.rehydrateSessionSlotFromHistory(input.sessionId, {
        afterSeq,
        requestHeaders: input.requestHeaders,
        measurementOperationId: input.streamMeasurementOperationId,
        timeoutMs: 5_000,
        isCurrent: input.isStillCurrent,
      });
      void reconcileHistoryTail.then((applied) => {
        const slotAfterHistory = getSessionRecord(input.sessionId);
        logDevSessionRuntimeEvent(input.sessionId, "stream_gap_reconcile_finished", {
          applied,
          afterStatus: slotAfterHistory?.status ?? null,
          afterPhase: slotAfterHistory?.executionSummary?.phase ?? null,
          afterIsStreaming: slotAfterHistory?.transcript.isStreaming ?? null,
          afterLastSeq: slotAfterHistory?.transcript.lastSeq ?? null,
        });
      }).catch((error: unknown) => {
        logDevSessionRuntimeEvent(input.sessionId, "stream_gap_reconcile_failed", {
          errorName: error instanceof Error ? error.name : "unknown",
          message: error instanceof Error ? error.message : String(error),
        });
      }).finally(() => {
        input.scheduleReconnect(0);
      });
      input.clearActiveSummaryRefreshTimer();
      input.closeCurrentHandle();
    }
  };

  return {
    enqueue(envelope) {
      if (disposed) {
        return;
      }
      queue.push(envelope);
      scheduleFlush();
    },
    flushNow() {
      if (cancelScheduledFlush) {
        cancelScheduledFlush();
        cancelScheduledFlush = null;
      }
      clearFlushWatchdog();
      flush();
    },
    dispose() {
      disposed = true;
      queue = [];
      if (cancelScheduledFlush) {
        cancelScheduledFlush();
        cancelScheduledFlush = null;
      }
      clearFlushWatchdog();
    },
  };
}

function markWorkspaceViewedAtFromStream(workspaceKey: string, timestamp: string) {
  streamWorkspaceViewedThrottle.record(workspaceKey, timestamp);
}

function reconcileBatchPendingConfigChanges(
  envelopes: readonly SessionEventEnvelope[],
  pendingConfigChanges: PendingSessionConfigChanges,
): BatchConfigReconcileResult {
  let nextPendingConfigChanges = pendingConfigChanges;
  const reconciledIntents: BatchConfigReconcileResult["reconciledIntents"] = [];
  for (const envelope of envelopes) {
    if (envelope.event.type !== "config_option_update") {
      continue;
    }
    const reconcileResult = reconcilePendingConfigChanges(
      envelope.event.liveConfig,
      nextPendingConfigChanges,
    );
    nextPendingConfigChanges = reconcileResult.pendingConfigChanges;
    if (reconcileResult.reconciledChanges.length > 0) {
      reconciledIntents.push({
        liveConfig: envelope.event.liveConfig,
        reconciledChanges: reconcileResult.reconciledChanges,
      });
    }
  }
  return {
    pendingConfigChanges: nextPendingConfigChanges,
    reconciledIntents,
  };
}

function recordStreamStateCounts(
  operationId: MeasurementOperationId | null | undefined,
  phase: "before" | "after",
  events: readonly SessionEventEnvelope[],
  transcript: TranscriptState,
): void {
  if (!operationId) {
    return;
  }
  const isBefore = phase === "before";
  recordMeasurementMetric({
    type: "state_count",
    operationId,
    target: isBefore ? "session.stream.events_before" : "session.stream.events_after",
    count: events.length,
  });
  recordMeasurementMetric({
    type: "state_count",
    operationId,
    target: isBefore ? "session.stream.turns_before" : "session.stream.turns_after",
    count: transcript.turnOrder.length,
  });
  recordMeasurementMetric({
    type: "state_count",
    operationId,
    target: isBefore ? "session.stream.items_before" : "session.stream.items_after",
    count: Object.keys(transcript.itemsById).length,
  });
}

function markSessionApplyForNextCommit(operationId: MeasurementOperationId | null | undefined): void {
  if (!operationId) {
    return;
  }
  markOperationForNextCommit(operationId, SESSION_APPLY_MEASUREMENT_SURFACES);
}

function maxEnvelopeSeq(
  envelopes: readonly SessionEventEnvelope[],
  fallbackSeq: number,
): number {
  let maxSeq = fallbackSeq;
  for (const envelope of envelopes) {
    maxSeq = Math.max(maxSeq, envelope.seq);
  }
  return maxSeq;
}
