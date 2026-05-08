import type {
  MeasurementFinishReason,
  MeasurementOperationAggregate,
  MeasurementOperationRecord,
  MeasurementSummaryPayload,
  MeasurementSummaryRow,
  MeasurementSurface,
} from "./debug-measurement-types";
import { now, pushBounded, round } from "./debug-measurement-utils";

const RECENT_SUMMARY_LIMIT = 500;
const HOT_BUDGET_REQUEST_COUNT = 0;
const HOT_BUDGET_FIRST_COMMIT_MS = 50;
const HOT_BUDGET_MAX_FRAME_GAP_MS = 50;
const HOT_BUDGET_MAX_COMMIT_MS = 16;
const HOT_BUDGET_TOTAL_COMMIT_MS = 80;
const HOT_SURFACE_COMMIT_BUDGETS: Partial<Record<MeasurementSurface, number>> = {
  "workspace-shell": 2,
  "chat-surface": 2,
  "session-transcript-pane": 2,
  "transcript-list": 2,
  "header-tabs": 3,
  "workspace-sidebar": 3,
};

export function isHotPaintOperationKind(kind: string): boolean {
  return kind === "workspace_hot_reopen" || kind === "session_hot_switch";
}

interface HotBudgetSummary {
  passed: boolean;
  failureLabels: string;
  surfaceCommitFailures: string;
  requestCount: number;
  firstCommitMs: number | null;
  maxFrameGapMs: number;
  maxCommitMs: number;
  totalCommitMs: number;
}

function evaluateHotBudget(aggregate: MeasurementOperationAggregate): HotBudgetSummary {
  const failures: string[] = [];
  const surfaceFailures: string[] = [];
  const firstCommitMs = aggregate.firstCommitAtMs === null
    ? null
    : round(aggregate.firstCommitAtMs);
  const maxFrameGapMs = round(aggregate.maxFrameGapMs);
  const maxCommitMs = round(aggregate.maxCommitMs);
  const totalCommitMs = round(aggregate.totalCommitMs);

  if (aggregate.requestCount !== HOT_BUDGET_REQUEST_COUNT) {
    failures.push("request_count");
  }
  if (firstCommitMs === null || firstCommitMs > HOT_BUDGET_FIRST_COMMIT_MS) {
    failures.push("first_commit_ms");
  }
  if (maxFrameGapMs > HOT_BUDGET_MAX_FRAME_GAP_MS) {
    failures.push("max_frame_gap_ms");
  }
  if (maxCommitMs > HOT_BUDGET_MAX_COMMIT_MS) {
    failures.push("max_commit_ms");
  }
  if (totalCommitMs > HOT_BUDGET_TOTAL_COMMIT_MS) {
    failures.push("total_commit_ms");
  }

  for (const [surface, budget] of Object.entries(HOT_SURFACE_COMMIT_BUDGETS)) {
    if (budget === undefined) {
      continue;
    }
    const breakdown = aggregate.surfaceBreakdowns.get(surface as MeasurementSurface);
    const actual = breakdown?.reactCommitCount ?? 0;
    if (actual > budget) {
      failures.push("surface_commit_count");
      surfaceFailures.push(`${surface}:${actual}/${budget}`);
    }
  }

  return {
    passed: failures.length === 0,
    failureLabels: [...new Set(failures)].join(","),
    surfaceCommitFailures: surfaceFailures.join(","),
    requestCount: aggregate.requestCount,
    firstCommitMs,
    maxFrameGapMs,
    maxCommitMs,
    totalCommitMs,
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
      target: "session.stream",
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

  const hotBudget = isHotPaintOperationKind(operation.kind)
    ? evaluateHotBudget(a)
    : null;
  if (hotBudget) {
    rows.push({
      ...base,
      rowKind: "budget",
      target: "hot_paint",
      durationMs: null,
      pass: hotBudget.passed,
      failureLabels: hotBudget.failureLabels,
      requestCount: hotBudget.requestCount,
      requestBudgetCount: HOT_BUDGET_REQUEST_COUNT,
      firstCommitMs: hotBudget.firstCommitMs,
      firstCommitBudgetMs: HOT_BUDGET_FIRST_COMMIT_MS,
      maxFrameGapMs: hotBudget.maxFrameGapMs,
      maxFrameGapBudgetMs: HOT_BUDGET_MAX_FRAME_GAP_MS,
      maxCommitMs: hotBudget.maxCommitMs,
      maxCommitBudgetMs: HOT_BUDGET_MAX_COMMIT_MS,
      totalCommitMs: hotBudget.totalCommitMs,
      totalCommitBudgetMs: HOT_BUDGET_TOTAL_COMMIT_MS,
      surfaceCommitFailures: hotBudget.surfaceCommitFailures,
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
  if (hotBudget && !hotBudget.passed) {
    console.error("[debug-measurement] hot paint budget violated", {
      operationId: operation.id,
      operationKind: operation.kind,
      failureLabels: hotBudget.failureLabels,
      requestCount: hotBudget.requestCount,
      firstCommitMs: hotBudget.firstCommitMs,
      maxFrameGapMs: hotBudget.maxFrameGapMs,
      maxCommitMs: hotBudget.maxCommitMs,
      totalCommitMs: hotBudget.totalCommitMs,
      surfaceCommitFailures: hotBudget.surfaceCommitFailures,
    });
  }
}
