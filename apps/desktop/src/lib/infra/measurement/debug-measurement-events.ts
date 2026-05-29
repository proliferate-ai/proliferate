import { metricSnapshot } from "./debug-measurement-snapshots";
import {
  RECENT_MEMORY_SAMPLE_LIMIT,
  RECENT_METRIC_LIMIT,
  RECENT_OPERATION_EVENT_LIMIT,
  nextMeasurementMemoryEventSeq,
  nextMeasurementMetricEventSeq,
  nextMeasurementOperationEventSeq,
  operations,
  recentMemorySamples,
  recentMetrics,
  recentOperationEvents,
  recentSummaries,
} from "./debug-measurement-state";
import type {
  MeasurementFinishReason,
  MeasurementOperationId,
} from "./debug-measurement-catalog-types";
import type { MeasurementMetricInput } from "./debug-measurement-metric-types";
import type { MeasurementOperationRecord } from "./debug-measurement-registry-types";
import {
  getMeasurementMemorySnapshot,
  getTimeOrigin,
  now,
  pushBounded,
  round,
} from "./debug-measurement-utils";

export function recordMetricEvent(
  input: MeasurementMetricInput,
  operationIds: MeasurementOperationId[],
): void {
  pushBounded(recentMetrics, {
    tag: "measurement_metric",
    seq: nextMeasurementMetricEventSeq(),
    timestampMs: Date.now(),
    timeOriginMs: getTimeOrigin(),
    operationIds,
    metric: metricSnapshot(input),
  }, RECENT_METRIC_LIMIT);
}

export function recordOperationEvent(
  operation: MeasurementOperationRecord,
  phase: "start" | "finish",
  finishReason?: MeasurementFinishReason,
): void {
  pushBounded(recentOperationEvents, {
    tag: "measurement_operation",
    seq: nextMeasurementOperationEventSeq(),
    timestampMs: Date.now(),
    timeOriginMs: getTimeOrigin(),
    phase,
    operationId: operation.id,
    operationKind: operation.kind,
    finishReason,
    durationMs: phase === "finish" ? round(now() - operation.startedAt) : undefined,
    surfaces: [...operation.surfaces],
    sampleKey: operation.sampleKey,
  }, RECENT_OPERATION_EVENT_LIMIT);
}

export function recordMemorySample(): void {
  const memory = getMeasurementMemorySnapshot();
  pushBounded(recentMemorySamples, {
    tag: "measurement_memory",
    seq: nextMeasurementMemoryEventSeq(),
    timestampMs: Date.now(),
    timeOriginMs: getTimeOrigin(),
    activeOperations: operations.size,
    recentMetrics: recentMetrics.length,
    recentSummaries: recentSummaries.length,
    ...memory,
  }, RECENT_MEMORY_SAMPLE_LIMIT);
}

export function clearDebugMeasurementBuffer(): void {
  recentMetrics.length = 0;
  recentOperationEvents.length = 0;
  recentMemorySamples.length = 0;
  recentSummaries.length = 0;
}
