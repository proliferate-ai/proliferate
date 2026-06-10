import type {
  SessionEventEnvelope,
  TranscriptState,
} from "@anyharness/sdk";
import type {
  SessionChildRelationship,
  SessionRelationship,
} from "@/lib/domain/sessions/directory/relationship";
import { applyStreamEnvelopeBatch } from "@/lib/domain/sessions/stream/stream-state";
import {
  logDevSSEEvent,
} from "@/lib/infra/debug/dev-sse-event-log";
import { logDevSessionRuntimeEvent } from "@/lib/infra/debug/dev-session-runtime-log";
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
  type PendingSessionConfigChanges,
} from "@proliferate/product-domain/sessions/pending-config";
import { buildSessionStreamBatchPatch } from "@/lib/domain/sessions/stream-patch";
import { shouldClearOptimisticPendingPromptForEnvelope } from "@proliferate/product-domain/chats/pending-prompts/pending-prompts";
import {
  applyBatchedStreamSideEffects,
} from "@/hooks/sessions/lifecycle/session-stream-side-effects";
import {
  createLatestTimestampThrottle,
} from "@/lib/domain/sessions/stream/latest-timestamp-throttle";
import { batchSessionStoreWrites } from "@/lib/infra/scheduling/react-batching";
import { activityFromTranscript } from "@/lib/domain/sessions/directory/directory-activity";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { getSessionRecord } from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionIngestStore } from "@/stores/sessions/session-ingest-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";
import type {
  BatchConfigReconcileResult,
  SessionStreamFlushControllerOptions,
  SessionStreamFlushFactoryDeps,
} from "@/hooks/sessions/lifecycle/session-stream-flush-types";

const SESSION_STREAM_EVENT_BATCH_IDLE_MS = 350;
const SESSION_STREAM_EVENT_BATCH_MAX_DURATION_MS = 5_000;
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

export interface AppliedStreamFlushBatch {
  applied: boolean;
  shouldDisconnectForGap: boolean;
  afterSeq: number;
}

export function applySessionStreamFlushBatch(
  input: SessionStreamFlushControllerOptions & SessionStreamFlushFactoryDeps,
  envelopes: SessionEventEnvelope[],
): AppliedStreamFlushBatch | null {
  const slotState = getSessionRecord(input.sessionId);
  if (!slotState) {
    logDevSessionRuntimeEvent(input.sessionId, "stream_flush_skipped", {
      reason: "missing_slot",
      envelopeCount: envelopes.length,
      firstSeq: envelopes[0]?.seq ?? null,
      lastSeq: envelopes[envelopes.length - 1]?.seq ?? null,
    });
    return null;
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
    recordStreamStateCounts(operationId, "before", slotState.events, slotState.transcript);
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
    // Duplicate envelopes were applied through another path (e.g. a history
    // tail rehydrate racing the stream), so the outbox may not have seen
    // their prompt echoes yet. Reconciliation is idempotent, so replaying
    // duplicates here is safe and keeps accepted prompts from lingering as
    // blocking entries.
    useSessionIntentStore.getState().reconcileFromEnvelopes(
      input.sessionId,
      result.duplicateEnvelopes,
      slotState.transcript,
    );
    useSessionIngestStore.getState().applyStreamProgress(input.sessionId, {
      lastAppliedSeq: slotState.transcript.lastSeq,
      lastObservedSeq,
      gapAfterSeq: null,
    });
    finishOrCancelMeasurementOperation(streamEventBatchOperationId, "completed");
    return {
      applied: false,
      shouldDisconnectForGap: false,
      afterSeq: slotState.transcript.lastSeq,
    };
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
    : { transcript: slotState.transcript };
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
    // Duplicates are reconciled too: they may have been applied first by a
    // racing history rehydrate, in which case this flush is the outbox's only
    // chance to observe their prompt echoes. Reconciliation is idempotent.
    useSessionIntentStore.getState().reconcileFromEnvelopes(
      input.sessionId,
      [...result.duplicateEnvelopes, ...result.appliedEnvelopes].sort(
        (left, right) => left.seq - right.seq,
      ),
      result.state.transcript,
    );
    useSessionDirectoryStore.getState().patchEntry(input.sessionId, {
      liveConfig: streamPatch.liveConfig !== undefined
        ? streamPatch.liveConfig
        : slotState.liveConfig,
      executionSummary: streamPatch.executionSummary !== undefined
        ? streamPatch.executionSummary
        : slotState.executionSummary,
      modelId: streamPatch.modelId !== undefined ? streamPatch.modelId : slotState.modelId,
      requestedModelId: streamPatch.requestedModelId !== undefined
        ? streamPatch.requestedModelId
        : slotState.requestedModelId,
      modeId: streamPatch.modeId !== undefined ? streamPatch.modeId : slotState.modeId,
      title: streamPatch.title !== undefined ? streamPatch.title : slotState.title,
      status: streamPatch.status !== undefined ? streamPatch.status : slotState.status,
      pendingConfigChanges: {},
      activity: activityFromTranscript(streamPatch.transcript, {
        status: streamPatch.status !== undefined ? streamPatch.status : slotState.status,
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
    recordStreamStateCounts(operationId, "after", result.state.events, result.state.transcript);
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
  return {
    applied: true,
    shouldDisconnectForGap,
    afterSeq: result.state.transcript.lastSeq,
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
