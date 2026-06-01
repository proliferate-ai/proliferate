import type {
  SessionEventEnvelope,
  TranscriptState,
} from "@anyharness/sdk";
import { resolveSessionStatus } from "@proliferate/product-domain/sessions/activity";
import {
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  recordMeasurementMetric,
} from "@/lib/infra/measurement/debug-measurement";
import type {
  MeasurementOperationId,
  MeasurementOperationKind,
  MeasurementSurface,
} from "@/lib/domain/telemetry/debug-measurement-catalog";
import { scheduleAfterNextPaint } from "@/lib/infra/scheduling/schedule-after-next-paint";
import { batchSessionStoreWrites } from "@/lib/infra/scheduling/react-batching";
import { activityFromTranscript } from "@/lib/domain/sessions/directory/directory-activity";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import type { SessionRuntimeRecord } from "@/stores/sessions/session-types";

export const SESSION_APPLY_MEASUREMENT_SURFACES: readonly MeasurementSurface[] = [
  "session-transcript-pane",
  "transcript-list",
  "chat-surface",
  "header-tabs",
  "workspace-sidebar",
  "global-header",
  "chat-composer-dock",
];
export const SESSION_HISTORY_APPLY_MAX_DURATION_MS = 30_000;

export function isSessionHistoryTimeoutAbort(error: unknown): boolean {
  return error instanceof Error
    && error.name === "AbortError"
    && error.message === "Session history request timed out";
}

export function resolveHistoryApplyOperationKind(input: {
  afterSeq?: number;
  beforeSeq?: number;
}): MeasurementOperationKind {
  if (input.beforeSeq != null) {
    return "session_history_older_chunk";
  }
  if (input.afterSeq != null) {
    return "session_history_tail_reconcile";
  }
  return "session_history_initial_hydrate";
}

export function finishStandaloneApplyOperation(
  operationId: MeasurementOperationId | null,
  reason: "completed" | "aborted" | "error_sanitized",
  waitForPaint = false,
): void {
  if (!operationId) {
    return;
  }
  const finish = () => finishOrCancelMeasurementOperation(operationId, reason);
  if (waitForPaint) {
    scheduleAfterNextPaint(finish);
    return;
  }
  finish();
}

export function markSessionApplyForNextCommit(operationId: MeasurementOperationId | null | undefined): void {
  if (!operationId) {
    return;
  }
  markOperationForNextCommit(operationId, SESSION_APPLY_MEASUREMENT_SURFACES);
}

export function applyHistoryStateToStores(
  sessionId: string,
  currentRecord: SessionRuntimeRecord,
  nextState: {
    events: SessionEventEnvelope[];
    transcript: TranscriptState;
  },
): void {
  const status = resolveSessionStatus(currentRecord.status, {
    executionSummary: currentRecord.executionSummary,
    streamConnectionState: currentRecord.streamConnectionState,
    transcript: nextState.transcript,
  });
  batchSessionStoreWrites(() => {
    useSessionTranscriptStore.getState().patchEntry(sessionId, {
      events: nextState.events,
      transcript: nextState.transcript,
    });
    useSessionDirectoryStore.getState().patchEntry(sessionId, {
      status,
      modeId: nextState.transcript.currentModeId ?? currentRecord.modeId,
      activity: activityFromTranscript(nextState.transcript, {
        status,
        executionSummary: currentRecord.executionSummary,
      }),
    });
  });
}

export function recordHistoryStateCounts(
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
    target: isBefore ? "session.history.events_before" : "session.history.events_after",
    count: events.length,
  });
  recordMeasurementMetric({
    type: "state_count",
    operationId,
    target: isBefore ? "session.history.turns_before" : "session.history.turns_after",
    count: transcript.turnOrder.length,
  });
  recordMeasurementMetric({
    type: "state_count",
    operationId,
    target: isBefore ? "session.history.items_before" : "session.history.items_after",
    count: Object.keys(transcript.itemsById).length,
  });
}
