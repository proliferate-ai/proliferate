import type {
  DurationAggregate,
  MeasurementOperationAggregate,
  MeasurementOperationRecord,
} from "./debug-measurement-registry-types";
import type { MeasurementMetricInput } from "./debug-measurement-metric-types";
import type { MeasurementAggregateSnapshot } from "./debug-measurement-report-types";
import { now, round } from "./debug-measurement-utils";

export function aggregateSnapshot(a: MeasurementOperationAggregate): MeasurementAggregateSnapshot {
  return {
    requestCount: a.requestCount,
    totalRequestMs: round(a.totalRequestMs),
    maxRequestMs: round(a.maxRequestMs),
    streamEventCount: a.streamEventCount,
    streamFirstEventMs: a.streamFirstEventMs === null ? null : round(a.streamFirstEventMs),
    maxStreamEventGapMs: round(a.maxStreamEventGapMs),
    malformedStreamEventCount: a.malformedStreamEventCount,
    cacheHitCount: a.cacheHitCount,
    cacheMissCount: a.cacheMissCount,
    cacheStaleCount: a.cacheStaleCount,
    cacheSkippedCount: a.cacheSkippedCount,
    reducerApplyCount: a.reducerApplyCount,
    totalReducerApplyMs: round(a.totalReducerApplyMs),
    maxReducerApplyMs: round(a.maxReducerApplyMs),
    storeApplyCount: a.storeApplyCount,
    totalStoreApplyMs: round(a.totalStoreApplyMs),
    maxStoreApplyMs: round(a.maxStoreApplyMs),
    reactCommitCount: a.reactCommitCount,
    firstCommitMs: a.firstCommitAtMs === null ? null : round(a.firstCommitAtMs),
    totalCommitMs: round(a.totalCommitMs),
    maxCommitMs: round(a.maxCommitMs),
    renderCount: a.renderCount,
    longTaskCount: a.longTaskCount,
    maxLongTaskMs: round(a.maxLongTaskMs),
    frameGapCount: a.frameGapCount,
    maxFrameGapMs: round(a.maxFrameGapMs),
    diagnosticCount: a.diagnosticCount,
    totalDiagnosticMs: round(a.totalDiagnosticMs),
    maxDiagnosticMs: round(a.maxDiagnosticMs),
  };
}


export function applyMetric(
  operation: MeasurementOperationRecord,
  input: MeasurementMetricInput,
): void {
  const aggregate = operation.aggregate;
  switch (input.type) {
    case "request":
      aggregate.requestCount += 1;
      aggregate.totalRequestMs += input.durationMs;
      aggregate.maxRequestMs = Math.max(aggregate.maxRequestMs, input.durationMs);
      applyRequestBreakdown(aggregate, input);
      break;
    case "stream":
      if (input.phase === "first_event" && input.durationMs !== undefined) {
        aggregate.streamFirstEventMs = aggregate.streamFirstEventMs === null
          ? input.durationMs
          : Math.min(aggregate.streamFirstEventMs, input.durationMs);
      }
      if (input.phase === "event") {
        aggregate.streamEventCount += input.eventCount ?? 1;
      }
      if (input.phase === "close") {
        aggregate.streamEventCount = Math.max(
          aggregate.streamEventCount,
          input.eventCount ?? 0,
        );
      }
      aggregate.maxStreamEventGapMs = Math.max(
        aggregate.maxStreamEventGapMs,
        input.maxInterArrivalGapMs ?? 0,
      );
      aggregate.malformedStreamEventCount = Math.max(
        aggregate.malformedStreamEventCount,
        input.malformedEventCount ?? aggregate.malformedStreamEventCount,
      );
      applyStreamBreakdown(aggregate, input);
      break;
    case "cache":
      if (input.decision === "hit") aggregate.cacheHitCount += 1;
      if (input.decision === "miss") aggregate.cacheMissCount += 1;
      if (input.decision === "stale") aggregate.cacheStaleCount += 1;
      if (input.decision === "skipped") aggregate.cacheSkippedCount += 1;
      applyCacheBreakdown(aggregate, input);
      break;
    case "reducer":
      aggregate.reducerApplyCount += input.count ?? 1;
      aggregate.totalReducerApplyMs += input.durationMs;
      aggregate.maxReducerApplyMs = Math.max(aggregate.maxReducerApplyMs, input.durationMs);
      applyDurationBreakdown(
        aggregate.reducerBreakdowns,
        input.category,
        input.durationMs,
        input.count,
      );
      break;
    case "store":
      aggregate.storeApplyCount += input.count ?? 1;
      aggregate.totalStoreApplyMs += input.durationMs;
      aggregate.maxStoreApplyMs = Math.max(aggregate.maxStoreApplyMs, input.durationMs);
      applyDurationBreakdown(
        aggregate.storeBreakdowns,
        input.category,
        input.durationMs,
        input.count,
      );
      break;
    case "workflow":
      applyWorkflowBreakdown(aggregate, input);
      break;
    case "state_count":
      applyStateCountBreakdown(aggregate, input);
      break;
    case "main_thread":
      applySurfaceBreakdown(aggregate, input);
      if (input.metric === "react_commit") {
        if (aggregate.firstCommitAtMs === null) {
          aggregate.firstCommitAtMs = now() - operation.startedAt;
        }
        aggregate.reactCommitCount += input.count ?? 1;
        aggregate.totalCommitMs += input.durationMs ?? 0;
        aggregate.maxCommitMs = Math.max(aggregate.maxCommitMs, input.durationMs ?? 0);
      }
      if (input.metric === "render_count") {
        aggregate.renderCount += input.count ?? 1;
      }
      if (input.metric === "long_task") {
        aggregate.longTaskCount += input.count ?? 1;
        aggregate.maxLongTaskMs = Math.max(aggregate.maxLongTaskMs, input.durationMs ?? 0);
      }
      if (input.metric === "frame_gap") {
        aggregate.frameGapCount += input.count ?? 1;
        aggregate.maxFrameGapMs = Math.max(aggregate.maxFrameGapMs, input.durationMs ?? 0);
      }
      break;
    case "diagnostic":
      aggregate.diagnosticCount += input.count ?? 1;
      aggregate.totalDiagnosticMs += input.durationMs ?? 0;
      aggregate.maxDiagnosticMs = Math.max(aggregate.maxDiagnosticMs, input.durationMs ?? 0);
      applyDiagnosticBreakdown(aggregate, input);
      break;
  }
}

function applyRequestBreakdown(
  aggregate: MeasurementOperationAggregate,
  input: Extract<MeasurementMetricInput, { type: "request" }>,
): void {
  const key = [
    input.transport,
    input.category,
    input.method,
    String(input.status),
  ].join(":");
  const breakdown = getOrCreate(aggregate.requestBreakdowns, key, () => ({
    transport: input.transport,
    category: input.category,
    method: input.method,
    status: input.status,
    count: 0,
    totalMs: 0,
    maxMs: 0,
  }));
  applyDurationAggregate(breakdown, input.durationMs);
}

function applyStreamBreakdown(
  aggregate: MeasurementOperationAggregate,
  input: Extract<MeasurementMetricInput, { type: "stream" }>,
): void {
  const breakdown = getOrCreate(aggregate.streamBreakdowns, `${input.category}:${input.phase}`, () => ({
    category: input.category,
    phase: input.phase,
    count: 0,
    totalMs: 0,
    maxMs: 0,
    eventCount: 0,
    maxInterArrivalGapMs: 0,
    malformedEventCount: 0,
  }));
  applyDurationAggregate(breakdown, input.durationMs ?? 0);
  breakdown.eventCount += input.eventCount ?? (input.phase === "event" ? 1 : 0);
  breakdown.maxInterArrivalGapMs = Math.max(
    breakdown.maxInterArrivalGapMs,
    input.maxInterArrivalGapMs ?? 0,
  );
  breakdown.malformedEventCount = Math.max(
    breakdown.malformedEventCount,
    input.malformedEventCount ?? breakdown.malformedEventCount,
  );
}

function applyCacheBreakdown(
  aggregate: MeasurementOperationAggregate,
  input: Extract<MeasurementMetricInput, { type: "cache" }>,
): void {
  const breakdown = getOrCreate(aggregate.cacheBreakdowns, input.category, () => ({
    category: input.category,
    hitCount: 0,
    missCount: 0,
    staleCount: 0,
    skippedCount: 0,
  }));
  if (input.decision === "hit") breakdown.hitCount += 1;
  if (input.decision === "miss") breakdown.missCount += 1;
  if (input.decision === "stale") breakdown.staleCount += 1;
  if (input.decision === "skipped") breakdown.skippedCount += 1;
}

function applyWorkflowBreakdown(
  aggregate: MeasurementOperationAggregate,
  input: Extract<MeasurementMetricInput, { type: "workflow" }>,
): void {
  const breakdown = getOrCreate(aggregate.workflowBreakdowns, input.step, () => ({
    step: input.step,
    count: 0,
    totalMs: 0,
    maxMs: 0,
    completedCount: 0,
    skippedCount: 0,
    cacheHitCount: 0,
    cacheMissCount: 0,
    errorSanitizedCount: 0,
  }));
  applyDurationAggregate(breakdown, input.durationMs, input.count);
  switch (input.outcome ?? "completed") {
    case "completed":
      breakdown.completedCount += input.count ?? 1;
      break;
    case "skipped":
      breakdown.skippedCount += input.count ?? 1;
      break;
    case "cache_hit":
      breakdown.cacheHitCount += input.count ?? 1;
      break;
    case "cache_miss":
      breakdown.cacheMissCount += input.count ?? 1;
      break;
    case "error_sanitized":
      breakdown.errorSanitizedCount += input.count ?? 1;
      break;
  }
}

function applyStateCountBreakdown(
  aggregate: MeasurementOperationAggregate,
  input: Extract<MeasurementMetricInput, { type: "state_count" }>,
): void {
  const breakdown = getOrCreate(aggregate.stateCountBreakdowns, input.target, () => ({
    target: input.target,
    samples: 0,
    latestCount: 0,
    maxCount: 0,
  }));
  breakdown.samples += 1;
  breakdown.latestCount = input.count;
  breakdown.maxCount = Math.max(breakdown.maxCount, input.count);
}

function applySurfaceBreakdown(
  aggregate: MeasurementOperationAggregate,
  input: Extract<MeasurementMetricInput, { type: "main_thread" }>,
): void {
  const breakdown = getOrCreate(aggregate.surfaceBreakdowns, input.surface, () => ({
    surface: input.surface,
    reactCommitCount: 0,
    totalCommitMs: 0,
    maxCommitMs: 0,
    renderCount: 0,
    longTaskCount: 0,
    maxLongTaskMs: 0,
    frameGapCount: 0,
    maxFrameGapMs: 0,
  }));
  if (input.metric === "react_commit") {
    breakdown.reactCommitCount += input.count ?? 1;
    breakdown.totalCommitMs += input.durationMs ?? 0;
    breakdown.maxCommitMs = Math.max(breakdown.maxCommitMs, input.durationMs ?? 0);
  }
  if (input.metric === "render_count") {
    breakdown.renderCount += input.count ?? 1;
  }
  if (input.metric === "long_task") {
    breakdown.longTaskCount += input.count ?? 1;
    breakdown.maxLongTaskMs = Math.max(breakdown.maxLongTaskMs, input.durationMs ?? 0);
  }
  if (input.metric === "frame_gap") {
    breakdown.frameGapCount += input.count ?? 1;
    breakdown.maxFrameGapMs = Math.max(breakdown.maxFrameGapMs, input.durationMs ?? 0);
  }
}

function applyDiagnosticBreakdown(
  aggregate: MeasurementOperationAggregate,
  input: Extract<MeasurementMetricInput, { type: "diagnostic" }>,
): void {
  const key = `${input.category}:${input.label}`;
  const breakdown = getOrCreate(aggregate.diagnosticBreakdowns, key, () => ({
    category: input.category,
    label: input.label,
    count: 0,
    totalMs: 0,
    maxMs: 0,
    latestKeys: "",
    latestDetail: null,
  }));
  applyDurationAggregate(breakdown, input.durationMs ?? 0, input.count);
  breakdown.latestKeys = (input.keys ?? []).join(",");
  breakdown.latestDetail = input.detail ?? null;
}

function applyDurationBreakdown(
  map: Map<string, DurationAggregate>,
  key: string,
  durationMs: number,
  count?: number,
): void {
  applyDurationAggregate(
    getOrCreate(map, key, () => ({ count: 0, totalMs: 0, maxMs: 0 })),
    durationMs,
    count,
  );
}

function applyDurationAggregate(
  aggregate: DurationAggregate,
  durationMs: number,
  count = 1,
): void {
  aggregate.count += count;
  aggregate.totalMs += durationMs;
  aggregate.maxMs = Math.max(aggregate.maxMs, durationMs);
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  const existing = map.get(key);
  if (existing) {
    return existing;
  }
  const next = create();
  map.set(key, next);
  return next;
}


export function createEmptyAggregate(): MeasurementOperationAggregate {
  return {
    requestCount: 0,
    totalRequestMs: 0,
    maxRequestMs: 0,
    streamEventCount: 0,
    streamFirstEventMs: null,
    maxStreamEventGapMs: 0,
    malformedStreamEventCount: 0,
    cacheHitCount: 0,
    cacheMissCount: 0,
    cacheStaleCount: 0,
    cacheSkippedCount: 0,
    reducerApplyCount: 0,
    totalReducerApplyMs: 0,
    maxReducerApplyMs: 0,
    storeApplyCount: 0,
    totalStoreApplyMs: 0,
    maxStoreApplyMs: 0,
    reactCommitCount: 0,
    firstCommitAtMs: null,
    totalCommitMs: 0,
    maxCommitMs: 0,
    renderCount: 0,
    longTaskCount: 0,
    maxLongTaskMs: 0,
    frameGapCount: 0,
    maxFrameGapMs: 0,
    diagnosticCount: 0,
    totalDiagnosticMs: 0,
    maxDiagnosticMs: 0,
    requestBreakdowns: new Map(),
    streamBreakdowns: new Map(),
    cacheBreakdowns: new Map(),
    reducerBreakdowns: new Map(),
    storeBreakdowns: new Map(),
    workflowBreakdowns: new Map(),
    stateCountBreakdowns: new Map(),
    surfaceBreakdowns: new Map(),
    diagnosticBreakdowns: new Map(),
  };
}
