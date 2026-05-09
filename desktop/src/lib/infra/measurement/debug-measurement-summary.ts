import type { MeasurementFinishReason } from "./debug-measurement-catalog-types";
import type {
  MeasurementOperationAggregate,
  MeasurementOperationRecord,
  MeasurementSummaryBudget,
} from "./debug-measurement-registry-types";
import type {
  MeasurementSummaryPayload,
  MeasurementSummaryRow,
} from "./debug-measurement-report-types";
import { now, pushBounded, round } from "./debug-measurement-utils";

const RECENT_SUMMARY_LIMIT = 500;

interface BudgetSummary {
  passed: boolean;
  failureLabels: string;
  surfaceCommitFailures: string;
  requestCount: number | null;
  requestBudgetCount: number | null;
  firstCommitMs: number | null;
  firstCommitBudgetMs: number | null;
  maxFrameGapMs: number;
  maxFrameGapBudgetMs: number | null;
  maxCommitMs: number;
  maxCommitBudgetMs: number | null;
  totalCommitMs: number;
  totalCommitBudgetMs: number | null;
}

function evaluateBudget(
  aggregate: MeasurementOperationAggregate,
  budget: MeasurementSummaryBudget,
): BudgetSummary {
  const failures: string[] = [];
  const surfaceFailures: string[] = [];
  const firstCommitMs = aggregate.firstCommitAtMs === null
    ? null
    : round(aggregate.firstCommitAtMs);
  const maxFrameGapMs = round(aggregate.maxFrameGapMs);
  const maxCommitMs = round(aggregate.maxCommitMs);
  const totalCommitMs = round(aggregate.totalCommitMs);

  if (budget.requestCount !== undefined && aggregate.requestCount !== budget.requestCount) {
    failures.push("request_count");
  }
  if (budget.firstCommitMs !== undefined && (firstCommitMs === null || firstCommitMs > budget.firstCommitMs)) {
    failures.push("first_commit_ms");
  }
  if (budget.maxFrameGapMs !== undefined && maxFrameGapMs > budget.maxFrameGapMs) {
    failures.push("max_frame_gap_ms");
  }
  if (budget.maxCommitMs !== undefined && maxCommitMs > budget.maxCommitMs) {
    failures.push("max_commit_ms");
  }
  if (budget.totalCommitMs !== undefined && totalCommitMs > budget.totalCommitMs) {
    failures.push("total_commit_ms");
  }

  for (const [surface, maxCommitCount] of Object.entries(budget.surfaceCommitBudgets ?? {})) {
    if (maxCommitCount === undefined) {
      continue;
    }
    const breakdown = aggregate.surfaceBreakdowns.get(surface);
    const actual = breakdown?.reactCommitCount ?? 0;
    if (actual > maxCommitCount) {
      failures.push("surface_commit_count");
      surfaceFailures.push(`${surface}:${actual}/${maxCommitCount}`);
    }
  }

  return {
    passed: failures.length === 0,
    failureLabels: [...new Set(failures)].join(","),
    surfaceCommitFailures: surfaceFailures.join(","),
    requestCount: budget.requestCount === undefined ? null : aggregate.requestCount,
    requestBudgetCount: budget.requestCount ?? null,
    firstCommitMs,
    firstCommitBudgetMs: budget.firstCommitMs ?? null,
    maxFrameGapMs,
    maxFrameGapBudgetMs: budget.maxFrameGapMs ?? null,
    maxCommitMs,
    maxCommitBudgetMs: budget.maxCommitMs ?? null,
    totalCommitMs,
    totalCommitBudgetMs: budget.totalCommitMs ?? null,
  };
}

export function printSummaryRow(input: {
  operation: MeasurementOperationRecord;
  reason: MeasurementFinishReason;
  longTaskObserverSupported: boolean;
  recentSummaries: MeasurementSummaryPayload[];
}): void {
  const { operation, reason, longTaskObserverSupported, recentSummaries } = input;
  const a = operation.aggregate;
  const durationMs = round(now() - operation.startedAt);
  const base = {
    tag: "measurement_summary",
    rowKind: "overall",
    operationId: operation.id,
    operationKind: operation.kind,
    finishReason: reason,
    devBuild: true,
    strictMode: true,
    longTaskObserverSupported,
  };
  const rows: MeasurementSummaryRow[] = [{
    ...base,
    target: "all",
    durationMs,
    surfaces: [...operation.surfaces].join(","),
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
  }];

  for (const breakdown of a.requestBreakdowns.values()) {
    rows.push({
      ...base,
      rowKind: "request",
      target: breakdown.category,
      durationMs: null,
      count: breakdown.count,
      totalMs: round(breakdown.totalMs),
      maxMs: round(breakdown.maxMs),
      transport: breakdown.transport,
      method: breakdown.method,
      status: breakdown.status,
    });
  }

  for (const breakdown of a.streamBreakdowns.values()) {
    rows.push({
      ...base,
      rowKind: "stream",
      target: breakdown.category,
      phase: breakdown.phase,
      durationMs: null,
      count: breakdown.count,
      totalMs: round(breakdown.totalMs),
      maxMs: round(breakdown.maxMs),
      eventCount: breakdown.eventCount,
      maxStreamEventGapMs: round(breakdown.maxInterArrivalGapMs),
      malformedStreamEventCount: breakdown.malformedEventCount,
    });
  }

  for (const breakdown of a.workflowBreakdowns.values()) {
    rows.push({
      ...base,
      rowKind: "workflow",
      target: breakdown.step,
      durationMs: null,
      count: breakdown.count,
      totalMs: round(breakdown.totalMs),
      maxMs: round(breakdown.maxMs),
      completedCount: breakdown.completedCount,
      skippedCount: breakdown.skippedCount,
      cacheHitCount: breakdown.cacheHitCount,
      cacheMissCount: breakdown.cacheMissCount,
      errorSanitizedCount: breakdown.errorSanitizedCount,
    });
  }

  for (const breakdown of a.cacheBreakdowns.values()) {
    rows.push({
      ...base,
      rowKind: "cache",
      target: breakdown.category,
      durationMs: null,
      cacheHitCount: breakdown.hitCount,
      cacheMissCount: breakdown.missCount,
      cacheStaleCount: breakdown.staleCount,
      cacheSkippedCount: breakdown.skippedCount,
    });
  }

  for (const breakdown of a.stateCountBreakdowns.values()) {
    rows.push({
      ...base,
      rowKind: "state_count",
      target: breakdown.target,
      durationMs: null,
      count: breakdown.latestCount,
      maxCount: breakdown.maxCount,
      samples: breakdown.samples,
    });
  }

  for (const [category, breakdown] of a.reducerBreakdowns) {
    rows.push({
      ...base,
      rowKind: "reducer",
      target: category,
      durationMs: null,
      count: breakdown.count,
      totalMs: round(breakdown.totalMs),
      maxMs: round(breakdown.maxMs),
    });
  }

  for (const [category, breakdown] of a.storeBreakdowns) {
    rows.push({
      ...base,
      rowKind: "store",
      target: category,
      durationMs: null,
      count: breakdown.count,
      totalMs: round(breakdown.totalMs),
      maxMs: round(breakdown.maxMs),
    });
  }

  for (const breakdown of a.surfaceBreakdowns.values()) {
    rows.push({
      ...base,
      rowKind: "surface",
      target: breakdown.surface,
      durationMs: null,
      reactCommitCount: breakdown.reactCommitCount,
      totalCommitMs: round(breakdown.totalCommitMs),
      maxCommitMs: round(breakdown.maxCommitMs),
      renderCount: breakdown.renderCount,
      longTaskCount: breakdown.longTaskCount,
      maxLongTaskMs: round(breakdown.maxLongTaskMs),
      frameGapCount: breakdown.frameGapCount,
      maxFrameGapMs: round(breakdown.maxFrameGapMs),
    });
  }

  for (const breakdown of a.diagnosticBreakdowns.values()) {
    rows.push({
      ...base,
      rowKind: "diagnostic",
      target: `${breakdown.category}:${breakdown.label}`,
      durationMs: null,
      count: breakdown.count,
      totalMs: round(breakdown.totalMs),
      maxMs: round(breakdown.maxMs),
      keys: breakdown.latestKeys,
      detail: breakdown.latestDetail,
    });
  }

  const budget = operation.summaryBudget
    ? evaluateBudget(a, operation.summaryBudget)
    : null;
  if (budget && operation.summaryBudget) {
    rows.push({
      ...base,
      rowKind: "budget",
      target: operation.summaryBudget.label,
      durationMs: null,
      pass: budget.passed,
      failureLabels: budget.failureLabels,
      requestCount: budget.requestCount,
      requestBudgetCount: budget.requestBudgetCount,
      firstCommitMs: budget.firstCommitMs,
      firstCommitBudgetMs: budget.firstCommitBudgetMs,
      maxFrameGapMs: budget.maxFrameGapMs,
      maxFrameGapBudgetMs: budget.maxFrameGapBudgetMs,
      maxCommitMs: budget.maxCommitMs,
      maxCommitBudgetMs: budget.maxCommitBudgetMs,
      totalCommitMs: budget.totalCommitMs,
      totalCommitBudgetMs: budget.totalCommitBudgetMs,
      surfaceCommitFailures: budget.surfaceCommitFailures,
    });
  }

  const payload: MeasurementSummaryPayload = {
    tag: "measurement_summary_json",
    operationId: operation.id,
    operationKind: operation.kind,
    finishReason: reason,
    durationMs,
    rows,
  };
  pushBounded(recentSummaries, payload, RECENT_SUMMARY_LIMIT);
  console.table(rows);
  console.debug("[measurement_summary_json]", JSON.stringify(payload));
  if (budget && !budget.passed) {
    console.error("[debug-measurement] measurement budget violated", {
      operationId: operation.id,
      operationKind: operation.kind,
      budget: operation.summaryBudget?.label ?? null,
      failureLabels: budget.failureLabels,
      requestCount: budget.requestCount,
      firstCommitMs: budget.firstCommitMs,
      maxFrameGapMs: budget.maxFrameGapMs,
      maxCommitMs: budget.maxCommitMs,
      totalCommitMs: budget.totalCommitMs,
      surfaceCommitFailures: budget.surfaceCommitFailures,
    });
  }
}
