import type {
  MeasurementFinishReason,
  MeasurementOperationId,
  MeasurementOperationKind,
  MeasurementSampleKey,
  MeasurementStateCountTarget,
  MeasurementSurface,
  MeasurementTimingCategory,
  MeasurementWorkflowStep,
} from "./debug-measurement-catalog-types";
import type { MeasurementMetricInput } from "./debug-measurement-metric-types";

export interface DurationAggregate {
  count: number;
  totalMs: number;
  maxMs: number;
}

export interface MeasurementRequestBreakdown extends DurationAggregate {
  transport: "anyharness" | "cloud";
  category: MeasurementTimingCategory;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  status: number | "network_error" | "aborted";
}

export interface MeasurementStreamBreakdown extends DurationAggregate {
  category: MeasurementTimingCategory;
  phase: Extract<MeasurementMetricInput, { type: "stream" }>["phase"];
  eventCount: number;
  maxInterArrivalGapMs: number;
  malformedEventCount: number;
}

export interface MeasurementCacheBreakdown {
  category: MeasurementTimingCategory;
  hitCount: number;
  missCount: number;
  staleCount: number;
  skippedCount: number;
}

export interface MeasurementWorkflowBreakdown extends DurationAggregate {
  step: MeasurementWorkflowStep;
  completedCount: number;
  skippedCount: number;
  cacheHitCount: number;
  cacheMissCount: number;
  errorSanitizedCount: number;
}

export interface MeasurementSurfaceBreakdown {
  surface: MeasurementSurface;
  reactCommitCount: number;
  totalCommitMs: number;
  maxCommitMs: number;
  renderCount: number;
  longTaskCount: number;
  maxLongTaskMs: number;
  frameGapCount: number;
  maxFrameGapMs: number;
}

export interface MeasurementStateCountBreakdown {
  target: MeasurementStateCountTarget;
  samples: number;
  latestCount: number;
  maxCount: number;
}

export interface MeasurementDiagnosticBreakdown extends DurationAggregate {
  category: string;
  label: string;
  latestKeys: string;
  latestDetail: string | null;
}

export interface MeasurementSummaryBudget {
  label: string;
  requestCount?: number;
  firstCommitMs?: number;
  maxFrameGapMs?: number;
  maxCommitMs?: number;
  totalCommitMs?: number;
  surfaceCommitBudgets?: Partial<Record<MeasurementSurface, number>>;
}

export interface MeasurementCategoryBindingInput {
  operationId: MeasurementOperationId;
  categories: readonly MeasurementTimingCategory[];
  scope: {
    runtimeUrlHash?: string;
    workspaceScope?: "selected" | "target";
    sampleKey?: MeasurementSampleKey;
  };
  ttlMs: number;
}

export interface MeasurementOperationAggregate {
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
  firstCommitAtMs: number | null;
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
  requestBreakdowns: Map<string, MeasurementRequestBreakdown>;
  streamBreakdowns: Map<string, MeasurementStreamBreakdown>;
  cacheBreakdowns: Map<string, MeasurementCacheBreakdown>;
  reducerBreakdowns: Map<string, DurationAggregate>;
  storeBreakdowns: Map<string, DurationAggregate>;
  workflowBreakdowns: Map<string, MeasurementWorkflowBreakdown>;
  stateCountBreakdowns: Map<MeasurementStateCountTarget, MeasurementStateCountBreakdown>;
  surfaceBreakdowns: Map<MeasurementSurface, MeasurementSurfaceBreakdown>;
  diagnosticBreakdowns: Map<string, MeasurementDiagnosticBreakdown>;
}

export interface MeasurementOperationRecord {
  id: MeasurementOperationId;
  kind: MeasurementOperationKind;
  surfaces: Set<MeasurementSurface>;
  sampleKey: MeasurementSampleKey | null;
  linkedLatencyFlowId: string | null;
  startedAt: number;
  idleTimeoutMs: number | null;
  maxDurationMs: number | null;
  cooldownMs: number;
  summaryBudget: MeasurementSummaryBudget | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  maxTimer: ReturnType<typeof setTimeout> | null;
  inFlightRequestCount: number;
  hasMetrics: boolean;
  aggregate: MeasurementOperationAggregate;
}

export type MeasurementOperationFinishListener = (input: {
  operationId: MeasurementOperationId;
  reason: MeasurementFinishReason;
}) => void;

export interface MeasurementCategoryBinding {
  id: string;
  operationId: MeasurementOperationId;
  categories: Set<MeasurementTimingCategory>;
  runtimeUrlHash: string | null;
  workspaceScope: "selected" | "target" | null;
  sampleKey: MeasurementSampleKey | null;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}
