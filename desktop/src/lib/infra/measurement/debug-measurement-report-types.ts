import type {
  MeasurementFinishReason,
  MeasurementOperationId,
  MeasurementOperationKind,
  MeasurementSampleKey,
  MeasurementSurface,
} from "./debug-measurement-catalog-types";
import type { MeasurementMetricSnapshot } from "./debug-measurement-metric-types";

export type MeasurementSummaryValue = string | number | boolean | null;
export type MeasurementSummaryRow = Record<string, MeasurementSummaryValue>;

export interface MeasurementSummaryPayload {
  tag: "measurement_summary_json";
  operationId: MeasurementOperationId;
  operationKind: MeasurementOperationKind;
  finishReason: MeasurementFinishReason;
  durationMs: number;
  rows: MeasurementSummaryRow[];
}

export interface MeasurementMetricEvent {
  tag: "measurement_metric";
  seq: number;
  timestampMs: number;
  timeOriginMs: number | null;
  operationIds: MeasurementOperationId[];
  metric: MeasurementMetricSnapshot;
}

export interface MeasurementOperationEvent {
  tag: "measurement_operation";
  seq: number;
  timestampMs: number;
  timeOriginMs: number | null;
  phase: "start" | "finish";
  operationId: MeasurementOperationId;
  operationKind: MeasurementOperationKind;
  finishReason?: MeasurementFinishReason;
  durationMs?: number;
  surfaces: MeasurementSurface[];
  sampleKey: MeasurementSampleKey | null;
}

export interface MeasurementOperationSnapshot {
  operationId: MeasurementOperationId;
  operationKind: MeasurementOperationKind;
  durationMs: number;
  surfaces: MeasurementSurface[];
  sampleKey: MeasurementSampleKey | null;
  linkedLatencyFlowId: string | null;
  hasMetrics: boolean;
  aggregate: MeasurementAggregateSnapshot;
}

export interface MeasurementAggregateSnapshot {
  requestCount: number;
  totalRequestMs: number;
  maxRequestMs: number;
  streamEventCount: number;
  streamFirstEventMs: number | null;
  maxStreamEventGapMs: number;
  malformedStreamEventCount: number;
  cacheHitCount: number;
  cacheMissCount: number;
  cacheStaleCount: number;
  cacheSkippedCount: number;
  reducerApplyCount: number;
  totalReducerApplyMs: number;
  maxReducerApplyMs: number;
  storeApplyCount: number;
  totalStoreApplyMs: number;
  maxStoreApplyMs: number;
  reactCommitCount: number;
  firstCommitMs: number | null;
  totalCommitMs: number;
  maxCommitMs: number;
  renderCount: number;
  longTaskCount: number;
  maxLongTaskMs: number;
  frameGapCount: number;
  maxFrameGapMs: number;
  diagnosticCount: number;
  totalDiagnosticMs: number;
  maxDiagnosticMs: number;
}

export interface MeasurementMemorySnapshot {
  usedJSHeapSize: number | null;
  totalJSHeapSize: number | null;
  jsHeapSizeLimit: number | null;
}

export interface MeasurementMemoryEvent extends MeasurementMemorySnapshot {
  tag: "measurement_memory";
  seq: number;
  timestampMs: number;
  timeOriginMs: number | null;
  activeOperations: number;
  recentMetrics: number;
  recentSummaries: number;
}

export interface MeasurementDebugDump {
  tag: "measurement_dump";
  version: 1;
  createdAt: string;
  timestampMs: number;
  timeOriginMs: number | null;
  enabled: {
    mainThread: boolean;
    anyHarnessTiming: boolean;
  };
  longTaskObserverSupported: boolean;
  memory: MeasurementMemorySnapshot;
  counts: {
    activeOperations: number;
    pendingCommitMarks: number;
    categoryBindings: number;
    recentOperationEvents: number;
    recentMetrics: number;
    recentMemorySamples: number;
    recentSummaries: number;
  };
  activeOperations: MeasurementOperationSnapshot[];
  recentOperationEvents: MeasurementOperationEvent[];
  recentMetrics: MeasurementMetricEvent[];
  recentMemorySamples: MeasurementMemoryEvent[];
  recentSummaries: MeasurementSummaryPayload[];
}

export interface MeasurementDebugStatus {
  enabled: MeasurementDebugDump["enabled"];
  counts: MeasurementDebugDump["counts"];
}

export interface MeasurementDebugApi {
  dump: () => MeasurementDebugDump;
  export: (fileName?: string) => MeasurementDebugDump;
  clear: () => void;
  status: () => MeasurementDebugStatus;
}

declare global {
  interface Window {
    proliferateDebugMeasurement?: MeasurementDebugApi;
    __PROLIFERATE_DEBUG_MEASUREMENT__?: MeasurementDebugApi;
  }
}
