import type { QueryClient } from "@tanstack/react-query";
import type {
  SessionEventEnvelope,
  TranscriptState,
} from "@anyharness/sdk";
import { useCallback } from "react";
import { applyStreamEnvelopeBatch } from "@/lib/integrations/anyharness/session-stream-state";
import { logDevSSEEvent } from "@/lib/integrations/anyharness/session-runtime";
import {
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  recordMeasurementMetric,
  startMeasurementOperation,
  type MeasurementOperationId,
  type MeasurementSurface,
} from "@/lib/infra/debug-measurement";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import type {
  SessionChildRelationship,
  SessionRelationship,
} from "@/stores/sessions/harness-store";
import { markWorkspaceViewedAt } from "@/stores/preferences/workspace-ui-store";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";
import { isDocumentVisibleAndFocused } from "@/hooks/ui/use-document-focus-visibility";
import {
  reconcilePendingConfigChanges,
  type PendingSessionConfigChange,
  type PendingSessionConfigChanges,
} from "@/lib/domain/sessions/pending-config";
import { shouldClearOptimisticPendingPrompt } from "@/lib/domain/chat/pending-prompts";
import { buildSessionStreamBatchPatch } from "@/lib/domain/sessions/stream-patch";
import {
  applyBatchedStreamSideEffects,
  type ReconciledStreamConfigIntent,
} from "@/hooks/sessions/session-stream-side-effects";

const SESSION_STREAM_EVENT_BATCH_IDLE_MS = 350;
const SESSION_STREAM_EVENT_BATCH_MAX_DURATION_MS = 5_000;
const SESSION_STREAM_FLUSH_MAX_PAINT_WAIT_MS = 50;
const SESSION_APPLY_MEASUREMENT_SURFACES: readonly MeasurementSurface[] = [
  "session-transcript-pane",
  "transcript-list",
  "chat-surface",
  "header-tabs",
  "workspace-sidebar",
  "global-header",
  "chat-composer-dock",
];

export interface SessionStreamFlushScheduler {
  schedule(callback: () => void): () => void;
}

export interface SessionStreamFlushController {
  enqueue(envelope: SessionEventEnvelope): void;
  flushNow(): void;
  dispose(): void;
}

interface SessionStreamFlushFactoryDeps {
  queryClient: QueryClient;
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

export const animationFrameSessionStreamFlushScheduler: SessionStreamFlushScheduler = {
  schedule(callback) {
    let settled = false;
    let frameId: number | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const run = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (frameId !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(frameId);
      }
      if (timerId !== null) {
        clearTimeout(timerId);
      }
      callback();
    };
    if (typeof requestAnimationFrame === "function") {
      frameId = requestAnimationFrame(run);
      // Hidden or minimized WebViews can pause rAF while SSE keeps delivering.
      // Keep stream state application bounded by a regular timer.
      timerId = setTimeout(run, SESSION_STREAM_FLUSH_MAX_PAINT_WAIT_MS);
      return () => {
        settled = true;
        if (frameId !== null && typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(frameId);
        }
        if (timerId !== null) {
          clearTimeout(timerId);
        }
      };
    }
    timerId = setTimeout(run, 0);
    return () => {
      settled = true;
      if (timerId !== null) {
        clearTimeout(timerId);
      }
    };
  },
};

export function useSessionStreamFlushControllerFactory({
  queryClient,
  mountSubagentChildSession,
  persistReconciledModePreferences,
  refreshSessionSlotMeta,
  showToast,
  scheduler = animationFrameSessionStreamFlushScheduler,
}: SessionStreamFlushFactoryDeps) {
  return useCallback((options: SessionStreamFlushControllerOptions) =>
    createSessionStreamFlushController({
      ...options,
      queryClient,
      mountSubagentChildSession,
      persistReconciledModePreferences,
      refreshSessionSlotMeta,
      showToast,
      scheduler,
    }), [
    mountSubagentChildSession,
    persistReconciledModePreferences,
    queryClient,
    refreshSessionSlotMeta,
    scheduler,
    showToast,
  ]);
}

export function createSessionStreamFlushController(
  input: SessionStreamFlushControllerOptions & SessionStreamFlushFactoryDeps,
): SessionStreamFlushController {
  const scheduler = input.scheduler ?? animationFrameSessionStreamFlushScheduler;
  let queue: SessionEventEnvelope[] = [];
  let cancelScheduledFlush: (() => void) | null = null;
  let disposed = false;

  const scheduleFlush = () => {
    if (cancelScheduledFlush || disposed) {
      return;
    }
    cancelScheduledFlush = scheduler.schedule(() => {
      cancelScheduledFlush = null;
      flush();
    });
  };

  const flush = () => {
    if (disposed || queue.length === 0) {
      return;
    }
    const envelopes = queue;
    queue = [];

    if (!input.isStillCurrent() || !input.isCurrentStream()) {
      return;
    }

    const currentState = useHarnessStore.getState();
    const slotState = currentState.sessionSlots[input.sessionId];
    if (!slotState) {
      return;
    }

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

    if (result.appliedEnvelopes.length === 0 && !result.gapEnvelope) {
      finishOrCancelMeasurementOperation(streamEventBatchOperationId, "completed");
      return;
    }

    const configReconcileResult = reconcileBatchPendingConfigChanges(
      result.appliedEnvelopes,
      slotState.pendingConfigChanges,
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
    const shouldClearOptimisticPrompt = result.appliedEnvelopes.some((envelope) =>
      shouldClearOptimisticPendingPrompt(envelope.event.type)
    );
    const shouldDisconnectForGap = !!result.gapEnvelope;

    const storeStartedAt = performance.now();
    useHarnessStore.getState().patchSessionSlot(input.sessionId, {
      events: result.state.events,
      ...streamPatch,
      optimisticPrompt: shouldClearOptimisticPrompt
        ? null
        : slotState.optimisticPrompt,
      pendingConfigChanges: configReconcileResult.pendingConfigChanges,
      ...(shouldDisconnectForGap
        ? {
          sseHandle: null,
          streamConnectionState: "disconnected" as const,
        }
        : {}),
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

    applyBatchedStreamSideEffects({
      ...input,
      runtimeUrl: currentState.runtimeUrl,
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
        useHarnessStore.getState().recordSessionRelationshipHint(sessionId, relationship);
      },
      getSessionRelationship: (sessionId: string): SessionRelationship | null =>
        useHarnessStore.getState().sessionSlots[sessionId]?.sessionRelationship ?? null,
      acknowledgeWorkspaceActivity: (workspaceId: string, timestamp: string) => {
        if (!isDocumentVisibleAndFocused()) {
          return;
        }
        const selectedWorkspaceId = useHarnessStore.getState().selectedWorkspaceId;
        if (workspaceId !== selectedWorkspaceId) {
          return;
        }
        const selectedLogicalWorkspaceId =
          useLogicalWorkspaceStore.getState().selectedLogicalWorkspaceId;
        markWorkspaceViewedAt(selectedLogicalWorkspaceId ?? workspaceId, timestamp);
      },
    });

    finishOrCancelMeasurementOperation(streamEventBatchOperationId, "completed");

    if (shouldDisconnectForGap) {
      input.clearActiveSummaryRefreshTimer();
      input.closeCurrentHandle();
      input.scheduleReconnect(0);
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
      flush();
    },
    dispose() {
      disposed = true;
      queue = [];
      if (cancelScheduledFlush) {
        cancelScheduledFlush();
        cancelScheduledFlush = null;
      }
    },
  };
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

function uniqueMeasurementOperationIds(
  operationIds: readonly (MeasurementOperationId | null | undefined)[],
): MeasurementOperationId[] {
  return [...new Set(operationIds.filter((id): id is MeasurementOperationId => !!id))];
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
