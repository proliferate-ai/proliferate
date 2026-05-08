import type {
  MeasurementMetricInput,
  MeasurementMetricSnapshot,
  MeasurementOperationRecord,
  MeasurementOperationSnapshot,
} from "./debug-measurement-types";
import { aggregateSnapshot } from "./debug-measurement-aggregate";
import { now, round } from "./debug-measurement-utils";

export function metricSnapshot(input: MeasurementMetricInput): MeasurementMetricSnapshot {
  switch (input.type) {
    case "request":
      return {
        type: "request",
        transport: input.transport,
        category: input.category,
        method: input.method,
        status: input.status,
        durationMs: round(input.durationMs),
        runtimeUrlHash: input.runtimeUrlHash ?? null,
      };
    case "stream":
      return {
        type: "stream",
        phase: input.phase,
        durationMs: input.durationMs === undefined ? null : round(input.durationMs),
        eventCount: input.eventCount ?? null,
        maxInterArrivalGapMs: input.maxInterArrivalGapMs === undefined
          ? null
          : round(input.maxInterArrivalGapMs),
        malformedEventCount: input.malformedEventCount ?? null,
        runtimeUrlHash: input.runtimeUrlHash ?? null,
      };
    case "cache":
      return {
        type: "cache",
        category: input.category,
        decision: input.decision,
        source: input.source,
      };
    case "reducer":
    case "store":
      return {
        type: input.type,
        category: input.category,
        durationMs: round(input.durationMs),
        count: input.count ?? null,
      };
    case "workflow":
      return {
        type: "workflow",
        step: input.step,
        durationMs: round(input.durationMs),
        count: input.count ?? null,
        outcome: input.outcome ?? null,
      };
    case "state_count":
      return {
        type: "state_count",
        target: input.target,
        count: input.count,
      };
    case "main_thread":
      return {
        type: "main_thread",
        surface: input.surface,
        metric: input.metric,
        durationMs: input.durationMs === undefined ? null : round(input.durationMs),
        count: input.count ?? null,
      };
    case "diagnostic":
      return {
        type: "diagnostic",
        category: input.category,
        label: input.label,
        durationMs: input.durationMs === undefined ? null : round(input.durationMs),
        count: input.count ?? null,
        keys: [...(input.keys ?? [])],
        detail: input.detail ?? null,
      };
  }
}

export function operationSnapshot(operation: MeasurementOperationRecord): MeasurementOperationSnapshot {
  return {
    operationId: operation.id,
    operationKind: operation.kind,
    durationMs: round(now() - operation.startedAt),
    surfaces: [...operation.surfaces],
    sampleKey: operation.sampleKey,
    linkedLatencyFlowId: operation.linkedLatencyFlowId,
    hasMetrics: operation.hasMetrics,
    aggregate: aggregateSnapshot(operation.aggregate),
  };
}
