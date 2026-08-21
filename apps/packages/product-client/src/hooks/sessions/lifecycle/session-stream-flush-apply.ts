import type {
  SessionEventEnvelope,
} from "@anyharness/sdk";
import type {
  SessionChildRelationship,
  SessionRelationship,
} from "#product/lib/domain/sessions/directory/relationship";
import { applyStreamEnvelopeBatch } from "#product/lib/domain/sessions/stream/stream-state";
import {
  logDevSSEEvent,
} from "#product/lib/infra/debug/dev-sse-event-log";
import { logDevSessionRuntimeEvent } from "#product/lib/infra/debug/dev-session-runtime-log";
import {
  recordSessionSyncBatchApplied,
  recordSessionSyncGapDetected,
} from "#product/lib/infra/diagnostics/renderer-diagnostic-migrations";
import { logLatency } from "#product/lib/infra/measurement/measurement-port";
import {
  finishOrCancelMeasurementOperation,
  recordMeasurementMetric,
  startMeasurementOperation,
} from "#product/lib/infra/measurement/measurement-port";
import type {
  MeasurementSurface,
} from "#product/lib/domain/telemetry/debug-measurement-catalog";
import { uniqueMeasurementOperationIds } from "#product/lib/infra/measurement/measurement-port";
import { markWorkspaceViewedAt } from "#product/stores/preferences/workspace-ui-store";
import { isDocumentVisibleAndFocused } from "#product/hooks/ui/document/use-document-focus-visibility";
import {
  pendingConfigChangesForSessionIntents,
} from "#product/domain/sessions/intents/session-intent-selectors";
import {
  sessionIntentsForSession,
} from "#product/domain/sessions/intents/session-intent-state";
import { turnHasAssistantRenderableTranscriptContent } from "#product/domain/chats/pending-prompts/pending-prompts";
import { finishRendererFlow } from "#product/lib/infra/diagnostics/renderer-flow-timing";
import {
  clearComposerSubmitTargetTurn,
  resolveComposerSubmitTargetTurnId,
} from "#product/hooks/sessions/lifecycle/session-stream-flush-composer-submit-turn";
import { buildSessionStreamBatchPatch } from "#product/lib/domain/sessions/stream-patch";
import { shouldClearOptimisticPendingPromptForEnvelope } from "#product/domain/chats/pending-prompts/pending-prompts";
import {
  applyBatchedStreamSideEffects,
} from "#product/hooks/sessions/lifecycle/session-stream-side-effects";
import {
  createLatestTimestampThrottle,
} from "#product/lib/domain/sessions/stream/latest-timestamp-throttle";
import { batchSessionStoreWrites } from "#product/lib/infra/scheduling/react-batching";
import { activityFromTranscript } from "#product/lib/domain/sessions/directory/directory-activity";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import {
  getMaterializedSessionId,
  getSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionIngestStore } from "#product/stores/sessions/session-ingest-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";
import { useSessionIntentStore } from "#product/stores/sessions/session-intent-store";
import type {
  SessionStreamFlushControllerOptions,
  SessionStreamFlushFactoryDeps,
} from "#product/hooks/sessions/lifecycle/session-stream-flush-types";
import {
  markSessionApplyForNextCommit,
  maxEnvelopeSeq,
  reconcileBatchPendingConfigChanges,
  recordStreamStateCounts,
} from "#product/hooks/sessions/lifecycle/session-stream-flush-helpers";

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
  const reducerElapsedMs = performance.now() - reducerStartedAt;
  for (const operationId of streamApplyOperationIds) {
    recordMeasurementMetric({
      type: "reducer",
      category: "session.stream",
      operationId,
      durationMs: reducerElapsedMs,
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
  // Reuses the reducer duration measured above rather than timing the batch a
  // second time.
  recordSessionSyncBatchApplied({
    sessionId: input.sessionId,
    applied: result.appliedEnvelopes.length,
    duplicates: result.duplicateEnvelopes.length,
    elapsedMs: Math.round(reducerElapsedMs),
  });
  if (result.gapEnvelope) {
    recordSessionSyncGapDetected({
      sessionId: input.sessionId,
      gapAfterSeq: result.state.transcript.lastSeq,
    });
  }

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
    input.reconcileWorkspacePinIntents(result.duplicateEnvelopes);
    // A duplicate-only flush repaired nothing, so it must not clear a gap
    // recorded earlier — clearing it would let the reopen flow skip the history
    // refill that repairs the hole.
    const recordedGapAfterSeq = useSessionIngestStore.getState()
      .freshnessByClientSessionId[input.sessionId]?.gapAfterSeq ?? null;
    useSessionIngestStore.getState().applyStreamProgress(input.sessionId, {
      lastAppliedSeq: slotState.transcript.lastSeq,
      lastObservedSeq,
      gapAfterSeq: recordedGapAfterSeq,
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
  // UX-latency R12: composer_submit's finish mark. First-visible-token isn't
  // observable here (no paint hook), so this uses the cheapest truthful proxy
  // already computed by this reducer: the SUBMITTED turn gaining its first
  // renderable assistant item. Scoped to the actual submitted turn (not just
  // whatever is turnOrder's last entry) so a reconnect/gap-fill batch that
  // completes an older turn can't satisfy this check before the new turn has
  // even started. Fires once (finishRendererFlow no-ops if the flow already
  // finished or was never begun for this sessionId).
  const composerSubmitTargetTurnId = resolveComposerSubmitTargetTurnId(
    input.sessionId,
    slotState.transcript,
    streamPatch.transcript,
  );
  if (composerSubmitTargetTurnId) {
    const targetTurnHadAssistantContentBefore = turnHasAssistantRenderableTranscriptContent(
      slotState.transcript.turnsById[composerSubmitTargetTurnId],
      slotState.transcript,
    );
    const targetTurnHasAssistantContentAfter = turnHasAssistantRenderableTranscriptContent(
      streamPatch.transcript.turnsById[composerSubmitTargetTurnId],
      streamPatch.transcript,
    );
    if (!targetTurnHadAssistantContentBefore && targetTurnHasAssistantContentAfter) {
      finishRendererFlow({
        kind: "composer_submit",
        correlationKey: input.sessionId,
      });
      clearComposerSubmitTargetTurn(input.sessionId);
    }
  }
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
      activeGoal: streamPatch.activeGoal !== undefined
        ? streamPatch.activeGoal
        : slotState.activeGoal,
      sessionActivity: streamPatch.sessionActivity !== undefined
        ? streamPatch.sessionActivity
        : slotState.sessionActivity,
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
    markSessionApplyForNextCommit(operationId, SESSION_APPLY_MEASUREMENT_SURFACES);
  }
  useSessionIngestStore.getState().applyStreamProgress(input.sessionId, {
    lastAppliedSeq: result.state.transcript.lastSeq,
    lastObservedSeq,
    gapAfterSeq: result.gapEnvelope ? result.state.transcript.lastSeq : null,
  });

  input.reconcileWorkspacePinIntents(
    [...result.duplicateEnvelopes, ...result.appliedEnvelopes].sort(
      (left, right) => left.seq - right.seq,
    ),
  );

  applyBatchedStreamSideEffects({
    ...input,
    materializedSessionId: getMaterializedSessionId(input.sessionId) ?? input.sessionId,
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
    resolveClientSessionId: (materializedSessionId: string): string | null =>
      useSessionDirectoryStore.getState()
        .clientSessionIdByMaterializedSessionId[materializedSessionId] ?? null,
    markSessionPromoted: (sessionIds: readonly string[], workspaceId: string | null) => {
      useSessionDirectoryStore.getState().markSessionPromoted(sessionIds, workspaceId);
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
