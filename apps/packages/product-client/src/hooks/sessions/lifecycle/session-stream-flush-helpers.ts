import type {
  SessionEventEnvelope,
  TranscriptState,
} from "@anyharness/sdk";
import {
  reconcilePendingConfigChanges,
  type PendingSessionConfigChanges,
} from "#product/domain/sessions/pending-config";
import {
  markOperationForNextCommit,
  recordMeasurementMetric,
} from "#product/lib/infra/measurement/measurement-port";
import type {
  MeasurementOperationId,
  MeasurementSurface,
} from "#product/lib/domain/telemetry/debug-measurement-catalog";
import type {
  BatchConfigReconcileResult,
} from "#product/hooks/sessions/lifecycle/session-stream-flush-types";

export function reconcileBatchPendingConfigChanges(
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

export function recordStreamStateCounts(
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

export function markSessionApplyForNextCommit(
  operationId: MeasurementOperationId | null | undefined,
  surfaces: readonly MeasurementSurface[],
): void {
  if (!operationId) {
    return;
  }
  markOperationForNextCommit(operationId, surfaces);
}

export function maxEnvelopeSeq(
  envelopes: readonly SessionEventEnvelope[],
  fallbackSeq: number,
): number {
  let maxSeq = fallbackSeq;
  for (const envelope of envelopes) {
    maxSeq = Math.max(maxSeq, envelope.seq);
  }
  return maxSeq;
}
