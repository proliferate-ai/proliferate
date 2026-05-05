import {
  hashTimingScope,
  type AnyHarnessMeasurementOperationId,
  type AnyHarnessRequestOptions,
  type AnyHarnessTimingCategory,
} from "@anyharness/sdk";

// Dev-only measurement plumbing. Collection is disabled unless the Vite dev
// build sets VITE_PROLIFERATE_DEBUG_MAIN_THREAD=1 or
// VITE_PROLIFERATE_DEBUG_ANYHARNESS_TIMING=1; emitted records are limited to
// ids, counts, durations, categories, and hashed scopes.

export type MeasurementOperationId = AnyHarnessMeasurementOperationId;

export type MeasurementOperationKind =
  | "workspace_open"
  | "workspace_collections_refresh"
  | "workspace_hot_reopen"
  | "session_switch"
  | "session_hot_switch"
  | "session_history_initial_hydrate"
  | "session_history_tail_reconcile"
  | "session_history_older_chunk"
  | "session_stream_sample"
  | "session_stream_event_batch"
  | "composer_typing"
  | "workspace_background_reconcile"
  | "transcript_scroll"
  | "file_tree_expand"
  | "file_tree_scroll"
  | "session_rename"
  | "workspace_rename"
  | "hover_sample";

export type MeasurementSurface =
  | "workspace-shell"
  | "workspace-sidebar"
  | "global-header"
  | "header-tabs"
  | "chat-surface"
  | "chat-composer"
  | "chat-composer-dock"
  | "session-transcript-pane"
  | "transcript-list"
  | "file-tree"
  | "loading-braille"
  | "send-button"
  | "stop-button"
  | "header-tab"
  | "sidebar-workspace-row";

export type MeasurementSampleKey =
  | "composer"
  | "transcript"
  | "file_tree"
  | "stream"
  | "send_button"
  | "stop_button"
  | "header_tab"
  | "sidebar_workspace_row";

export type MeasurementFinishReason =
  | "completed"
  | "idle"
  | "max_duration"
  | "unmount"
  | "navigation"
  | "aborted"
  | "disabled"
  | "error_sanitized";

export type MeasurementCloudCategory =
  | "cloud.workspace.list"
  | "cloud.workspace.display_name.update";

export type MeasurementTimingCategory =
  | AnyHarnessTimingCategory
  | MeasurementCloudCategory;

export type MeasurementWorkflowStep =
  | "workspace.hot_reopen.activate"
  | "workspace.hot_reopen.after_paint"
  | "workspace.hot_reopen.reconcile"
  | "workspace.collections.fetch"
  | "workspace.collections.build"
  | "workspace.bootstrap.sessions"
  | "workspace.bootstrap.file_tree_init"
  | "workspace.bootstrap.dismissed_sessions"
  | "workspace.bootstrap.launch_catalog"
  | "workspace.bootstrap.initial_session"
  | "workspace.bootstrap.session_select"
  | "session.select.hot_slot_activate"
  | "session.select.ensure_sessions"
  | "session.select.slot_store"
  | "session.select.history_hydrate"
  | "session.select.stream_connect"
  | "session.select.stream_connect_scheduled"
  | "session.history.fetch"
  | "session.history.replay"
  | "session.history.store"
  | "session.history.mount_subagents"
  | "session.history.resolve_target"
  | "session.summary.resolve_target"
  | "session.stream.initial_history_hydrate"
  | "session.stream.initial_refresh"
  | "session.stream.skip_cold_idle"
  | "session.stream.open_handle"
  | "session.stream.open"
  | "session.stream.resolve_target"
  | "session.resume.resolve_target"
  | "session.resume.workspace_get"
  | "session.resume.resolve_mcp";

export type MeasurementStateCountTarget =
  | "session.history.events_fetched"
  | "session.history.events_before"
  | "session.history.events_after"
  | "session.history.turns_before"
  | "session.history.turns_after"
  | "session.history.items_before"
  | "session.history.items_after"
  | "session.stream.events_before"
  | "session.stream.events_after"
  | "session.stream.turns_before"
  | "session.stream.turns_after"
  | "session.stream.items_before"
  | "session.stream.items_after";

export type MeasurementWorkflowOutcome =
  | "completed"
  | "skipped"
  | "cache_hit"
  | "cache_miss"
  | "error_sanitized";

export type MeasurementMetricInput =
  | {
      type: "request";
      transport: "anyharness" | "cloud";
      category: MeasurementTimingCategory;
      operationId?: MeasurementOperationId;
      runtimeUrlHash?: string;
      method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
      status: number | "network_error" | "aborted";
      durationMs: number;
    }
  | {
      type: "stream";
      category: "session.stream";
      operationId?: MeasurementOperationId;
      runtimeUrlHash?: string;
      phase:
        | "connect"
        | "first_event"
        | "event"
        | "close"
        | "abort"
        | "network_error";
      durationMs?: number;
      eventCount?: number;
      maxInterArrivalGapMs?: number;
      malformedEventCount?: number;
    }
  | {
      type: "cache";
      category: MeasurementTimingCategory;
      operationId?: MeasurementOperationId;
      decision: "hit" | "miss" | "stale" | "skipped";
      source: "react_query" | "workflow";
    }
  | {
      type: "reducer";
      category: MeasurementTimingCategory;
      operationId?: MeasurementOperationId;
      durationMs: number;
      count?: number;
    }
  | {
      type: "store";
      category: MeasurementTimingCategory;
      operationId?: MeasurementOperationId;
      durationMs: number;
      count?: number;
    }
  | {
      type: "workflow";
      step: MeasurementWorkflowStep;
      operationId?: MeasurementOperationId;
      durationMs: number;
      count?: number;
      outcome?: MeasurementWorkflowOutcome;
    }
  | {
      type: "state_count";
      target: MeasurementStateCountTarget;
      operationId?: MeasurementOperationId;
      count: number;
    }
  | {
      type: "main_thread";
      surface: MeasurementSurface;
      operationId?: MeasurementOperationId;
      metric: "react_commit" | "render_count" | "long_task" | "frame_gap";
      durationMs?: number;
      count?: number;
    }
  | {
      type: "diagnostic";
      category: string;
      label: string;
      operationId?: MeasurementOperationId;
      durationMs?: number;
      count?: number;
      keys?: readonly string[];
      detail?: string | null;
    };

type MeasurementSummaryValue = string | number | boolean | null;
type MeasurementSummaryRow = Record<string, MeasurementSummaryValue>;

interface MeasurementSummaryPayload {
  tag: "measurement_summary_json";
  operationId: MeasurementOperationId;
  operationKind: MeasurementOperationKind;
  finishReason: MeasurementFinishReason;
  durationMs: number;
  rows: MeasurementSummaryRow[];
}

interface MeasurementMetricEvent {
  tag: "measurement_metric";
  seq: number;
  timestampMs: number;
  timeOriginMs: number | null;
  operationIds: MeasurementOperationId[];
  metric: MeasurementMetricSnapshot;
}

interface MeasurementOperationEvent {
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

type MeasurementMetricSnapshot =
  | {
      type: "request";
      transport: "anyharness" | "cloud";
      category: MeasurementTimingCategory;
      method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
      status: number | "network_error" | "aborted";
      durationMs: number;
      runtimeUrlHash: string | null;
    }
  | {
      type: "stream";
      phase: Extract<MeasurementMetricInput, { type: "stream" }>["phase"];
      durationMs: number | null;
      eventCount: number | null;
      maxInterArrivalGapMs: number | null;
      malformedEventCount: number | null;
      runtimeUrlHash: string | null;
    }
  | {
      type: "cache";
      category: MeasurementTimingCategory;
      decision: "hit" | "miss" | "stale" | "skipped";
      source: "react_query" | "workflow";
    }
  | {
      type: "reducer" | "store";
      category: MeasurementTimingCategory;
      durationMs: number;
      count: number | null;
    }
  | {
      type: "workflow";
      step: MeasurementWorkflowStep;
      durationMs: number;
      count: number | null;
      outcome: MeasurementWorkflowOutcome | null;
    }
  | {
      type: "state_count";
      target: MeasurementStateCountTarget;
      count: number;
    }
  | {
      type: "main_thread";
      surface: MeasurementSurface;
      metric: "react_commit" | "render_count" | "long_task" | "frame_gap";
      durationMs: number | null;
      count: number | null;
    }
  | {
      type: "diagnostic";
      category: string;
      label: string;
      durationMs: number | null;
      count: number | null;
      keys: string[];
      detail: string | null;
    };

interface MeasurementOperationSnapshot {
  operationId: MeasurementOperationId;
  operationKind: MeasurementOperationKind;
  durationMs: number;
  surfaces: MeasurementSurface[];
  sampleKey: MeasurementSampleKey | null;
  linkedLatencyFlowId: string | null;
  hasMetrics: boolean;
  aggregate: MeasurementAggregateSnapshot;
}

interface MeasurementAggregateSnapshot {
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

interface MeasurementMemorySnapshot {
  usedJSHeapSize: number | null;
  totalJSHeapSize: number | null;
  jsHeapSizeLimit: number | null;
}

interface MeasurementMemoryEvent extends MeasurementMemorySnapshot {
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

interface DurationAggregate {
  count: number;
  totalMs: number;
  maxMs: number;
}

interface MeasurementRequestBreakdown extends DurationAggregate {
  transport: "anyharness" | "cloud";
  category: MeasurementTimingCategory;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  status: number | "network_error" | "aborted";
}

interface MeasurementStreamBreakdown extends DurationAggregate {
  phase: Extract<MeasurementMetricInput, { type: "stream" }>["phase"];
  eventCount: number;
  maxInterArrivalGapMs: number;
  malformedEventCount: number;
}

interface MeasurementCacheBreakdown {
  category: MeasurementTimingCategory;
  hitCount: number;
  missCount: number;
  staleCount: number;
  skippedCount: number;
}

interface MeasurementWorkflowBreakdown extends DurationAggregate {
  step: MeasurementWorkflowStep;
  completedCount: number;
  skippedCount: number;
  cacheHitCount: number;
  cacheMissCount: number;
  errorSanitizedCount: number;
}

interface MeasurementSurfaceBreakdown {
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

interface MeasurementStateCountBreakdown {
  target: MeasurementStateCountTarget;
  samples: number;
  latestCount: number;
  maxCount: number;
}

interface MeasurementDiagnosticBreakdown extends DurationAggregate {
  category: string;
  label: string;
  latestKeys: string;
  latestDetail: string | null;
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

interface MeasurementOperationAggregate {
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

interface MeasurementOperationRecord {
  id: MeasurementOperationId;
  kind: MeasurementOperationKind;
  surfaces: Set<MeasurementSurface>;
  sampleKey: MeasurementSampleKey | null;
  linkedLatencyFlowId: string | null;
  startedAt: number;
  idleTimeoutMs: number | null;
  maxDurationMs: number | null;
  cooldownMs: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  maxTimer: ReturnType<typeof setTimeout> | null;
  hasMetrics: boolean;
  aggregate: MeasurementOperationAggregate;
}

interface MeasurementCategoryBinding {
  id: string;
  operationId: MeasurementOperationId;
  categories: Set<MeasurementTimingCategory>;
  runtimeUrlHash: string | null;
  workspaceScope: "selected" | "target" | null;
  sampleKey: MeasurementSampleKey | null;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const MEASUREMENT_HEADER = "x-proliferate-measurement-operation-id";
// Diagnostic sessions can generate many short-lived events; this buffer is
// still dev-only because recordMeasurementMetric exits when measurement is off.
const RECENT_METRIC_LIMIT = 50_000;
const RECENT_OPERATION_EVENT_LIMIT = 1_000;
const RECENT_MEMORY_SAMPLE_LIMIT = 1_000;
const RECENT_SUMMARY_LIMIT = 500;
const MEMORY_SAMPLE_INTERVAL_MS = 5_000;
const operations = new Map<MeasurementOperationId, MeasurementOperationRecord>();
const activeSampleOperations = new Map<string, MeasurementOperationId>();
const cooldownUntilBySample = new Map<string, number>();
const pendingCommitMarks = new Map<MeasurementOperationId, Set<MeasurementSurface>>();
const categoryBindings = new Map<string, MeasurementCategoryBinding>();
const recentMetrics: MeasurementMetricEvent[] = [];
const recentOperationEvents: MeasurementOperationEvent[] = [];
const recentMemorySamples: MeasurementMemoryEvent[] = [];
const recentSummaries: MeasurementSummaryPayload[] = [];
let operationSeq = 0;
let bindingSeq = 0;
let metricEventSeq = 0;
let operationEventSeq = 0;
let memoryEventSeq = 0;
let longTaskObserverSupported = false;

function envFlagEnabled(value: string | boolean | undefined, defaultValue = false): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (!value) {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  return !["0", "false", "off", "no"].includes(normalized);
}

export function isMainThreadMeasurementEnabled(): boolean {
  return import.meta.env.DEV
    && envFlagEnabled(import.meta.env.VITE_PROLIFERATE_DEBUG_MAIN_THREAD, false);
}

export function isAnyHarnessTimingEnabled(): boolean {
  return import.meta.env.DEV
    && envFlagEnabled(import.meta.env.VITE_PROLIFERATE_DEBUG_ANYHARNESS_TIMING, false);
}

export function isDebugMeasurementEnabled(): boolean {
  return isMainThreadMeasurementEnabled() || isAnyHarnessTimingEnabled();
}

export function setLongTaskObserverSupportedForMeasurement(supported: boolean): void {
  longTaskObserverSupported = supported;
}

export function hashMeasurementScope(value: string): string {
  return hashTimingScope(value);
}

export function startMeasurementOperation(input: {
  kind: MeasurementOperationKind;
  surfaces: readonly MeasurementSurface[];
  sampleKey?: MeasurementSampleKey;
  linkedLatencyFlowId?: string;
  idleTimeoutMs?: number;
  maxDurationMs?: number;
  cooldownMs?: number;
}): MeasurementOperationId | null {
  if (!isDebugMeasurementEnabled()) {
    return null;
  }

  const sampleMapKey = input.sampleKey ? `${input.kind}:${input.sampleKey}` : null;
  if (sampleMapKey) {
    const existingId = activeSampleOperations.get(sampleMapKey);
    if (existingId && operations.has(existingId)) {
      touchMeasurementOperation(existingId);
      return existingId;
    }
    if ((cooldownUntilBySample.get(sampleMapKey) ?? 0) > now()) {
      return null;
    }
  }

  const id = `mop_${(++operationSeq).toString(36)}` as MeasurementOperationId;
  const operation: MeasurementOperationRecord = {
    id,
    kind: input.kind,
    surfaces: new Set(input.surfaces),
    sampleKey: input.sampleKey ?? null,
    linkedLatencyFlowId: input.linkedLatencyFlowId ?? null,
    startedAt: now(),
    idleTimeoutMs: input.idleTimeoutMs ?? null,
    maxDurationMs: input.maxDurationMs ?? null,
    cooldownMs: input.cooldownMs ?? 0,
    idleTimer: null,
    maxTimer: null,
    hasMetrics: false,
    aggregate: createEmptyAggregate(),
  };
  operations.set(id, operation);
  if (sampleMapKey) {
    activeSampleOperations.set(sampleMapKey, id);
  }
  recordOperationEvent(operation, "start");
  scheduleOperationTimers(operation);
  return id;
}

export function touchMeasurementOperation(id: MeasurementOperationId): void {
  const operation = operations.get(id);
  if (!operation) {
    return;
  }
  if (operation.idleTimer) {
    clearTimeout(operation.idleTimer);
    operation.idleTimer = null;
  }
  if (operation.idleTimeoutMs !== null) {
    operation.idleTimer = setTimeout(() => {
      finishMeasurementOperation(operation.id, "idle");
    }, operation.idleTimeoutMs);
  }
}

export function finishMeasurementOperation(
  id: MeasurementOperationId,
  reason: MeasurementFinishReason,
): void {
  const operation = operations.get(id);
  if (!operation) {
    return;
  }
  recordOperationEvent(operation, "finish", reason);
  cleanupOperation(operation);
  if (operation.hasMetrics) {
    printSummaryRow(operation, reason);
  }
}

export function cancelMeasurementOperation(
  id: MeasurementOperationId,
  reason: MeasurementFinishReason,
): void {
  const operation = operations.get(id);
  if (!operation) {
    return;
  }
  recordOperationEvent(operation, "finish", reason);
  cleanupOperation(operation);
  if (operation.hasMetrics) {
    printSummaryRow(operation, reason);
  }
}

export function finishOrCancelMeasurementOperation(
  id: MeasurementOperationId | null | undefined,
  reason: MeasurementFinishReason,
): void {
  if (!id) {
    return;
  }
  const operation = operations.get(id);
  if (!operation) {
    return;
  }
  if (operation.hasMetrics) {
    finishMeasurementOperation(id, reason);
  } else {
    cancelMeasurementOperation(id, reason);
  }
}

export function markOperationForNextCommit(
  id: MeasurementOperationId,
  surfaces: readonly MeasurementSurface[],
): void {
  if (!isMainThreadMeasurementEnabled() || !operations.has(id)) {
    return;
  }
  pendingCommitMarks.set(id, new Set(surfaces));
}

export function getMeasurementRequestOptions(input: {
  operationId?: MeasurementOperationId | null;
  category: AnyHarnessTimingCategory;
  headers?: HeadersInit;
}): AnyHarnessRequestOptions | undefined {
  if (!isAnyHarnessTimingEnabled()) {
    return input.headers ? { headers: input.headers } : undefined;
  }

  const options: AnyHarnessRequestOptions = {
    headers: input.headers,
    timingCategory: input.category,
  };
  if (input.operationId) {
    options.measurementOperationId = input.operationId;
    options.headers = mergeMeasurementHeader(input.headers, input.operationId);
  }
  return options;
}

export function bindMeasurementCategories(input: MeasurementCategoryBindingInput): () => void {
  if (!isDebugMeasurementEnabled() || !operations.has(input.operationId)) {
    return () => undefined;
  }
  const id = `binding_${++bindingSeq}`;
  const binding: MeasurementCategoryBinding = {
    id,
    operationId: input.operationId,
    categories: new Set(input.categories),
    runtimeUrlHash: input.scope.runtimeUrlHash ?? null,
    workspaceScope: input.scope.workspaceScope ?? null,
    sampleKey: input.scope.sampleKey ?? null,
    expiresAt: now() + input.ttlMs,
    timer: null,
  };
  binding.timer = setTimeout(() => {
    categoryBindings.delete(id);
  }, input.ttlMs);
  categoryBindings.set(id, binding);
  return () => {
    if (binding.timer) {
      clearTimeout(binding.timer);
    }
    categoryBindings.delete(id);
  };
}

export function recordMeasurementMetric(input: MeasurementMetricInput): void {
  if (!isDebugMeasurementEnabled()) {
    return;
  }
  const operationIds = resolveMetricOperationIds(input);
  recordMetricEvent(input, operationIds);
  for (const operationId of operationIds) {
    const operation = operations.get(operationId);
    if (!operation) {
      continue;
    }
    if (input.type === "request" && isHotPaintOperationKind(operation.kind)) {
      console.error("[debug-measurement] request attributed to hot paint operation", {
        operationId: operation.id,
        operationKind: operation.kind,
        category: input.category,
      });
    }
    operation.hasMetrics = true;
    applyMetric(operation.aggregate, input);
    touchMeasurementOperation(operation.id);
  }
}

function isHotPaintOperationKind(kind: MeasurementOperationKind): boolean {
  return kind === "workspace_hot_reopen" || kind === "session_hot_switch";
}

export function recordMeasurementWorkflowStep(input: {
  operationId?: MeasurementOperationId | null;
  step: MeasurementWorkflowStep;
  startedAt: number;
  outcome?: MeasurementWorkflowOutcome;
  count?: number;
}): void {
  if (!input.operationId) {
    return;
  }
  recordMeasurementMetric({
    type: "workflow",
    operationId: input.operationId,
    step: input.step,
    durationMs: now() - input.startedAt,
    outcome: input.outcome,
    count: input.count,
  });
}

export function recordMeasurementDiagnostic(input: {
  category: string;
  label: string;
  operationId?: MeasurementOperationId | null;
  startedAt?: number;
  durationMs?: number;
  count?: number;
  keys?: readonly string[];
  detail?: string | null;
}): void {
  recordMeasurementMetric({
    type: "diagnostic",
    category: input.category,
    label: input.label,
    operationId: input.operationId ?? undefined,
    durationMs: input.startedAt === undefined
      ? input.durationMs
      : now() - input.startedAt,
    count: input.count,
    keys: input.keys,
    detail: input.detail,
  });
}

export function measureDebugComputation<T>(input: {
  category: string;
  label: string;
  keys?: readonly string[];
  count?: (value: T) => number | undefined;
}, compute: () => T): T {
  if (!isDebugMeasurementEnabled()) {
    return compute();
  }
  const startedAt = now();
  const value = compute();
  recordMeasurementDiagnostic({
    category: input.category,
    label: input.label,
    startedAt,
    count: input.count?.(value),
    keys: input.keys,
  });
  return value;
}

export function resetDebugMeasurementForTest(): void {
  for (const operation of operations.values()) {
    clearOperationTimers(operation);
  }
  for (const binding of categoryBindings.values()) {
    if (binding.timer) {
      clearTimeout(binding.timer);
    }
  }
  operations.clear();
  activeSampleOperations.clear();
  cooldownUntilBySample.clear();
  pendingCommitMarks.clear();
  categoryBindings.clear();
  clearDebugMeasurementBuffer();
  operationSeq = 0;
  bindingSeq = 0;
  metricEventSeq = 0;
  operationEventSeq = 0;
  memoryEventSeq = 0;
  longTaskObserverSupported = false;
}

export function getDebugMeasurementDump(): MeasurementDebugDump {
  return {
    tag: "measurement_dump",
    version: 1,
    createdAt: new Date().toISOString(),
    timestampMs: Date.now(),
    timeOriginMs: getTimeOrigin(),
    enabled: {
      mainThread: isMainThreadMeasurementEnabled(),
      anyHarnessTiming: isAnyHarnessTimingEnabled(),
    },
    longTaskObserverSupported,
    memory: getMeasurementMemorySnapshot(),
    counts: getDebugMeasurementStatus().counts,
    activeOperations: [...operations.values()].map(operationSnapshot),
    recentOperationEvents: [...recentOperationEvents],
    recentMetrics: [...recentMetrics],
    recentMemorySamples: [...recentMemorySamples],
    recentSummaries: [...recentSummaries],
  };
}

export function clearDebugMeasurementBuffer(): void {
  recentMetrics.length = 0;
  recentOperationEvents.length = 0;
  recentMemorySamples.length = 0;
  recentSummaries.length = 0;
}

export function installDebugMeasurementExport(): () => void {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return () => undefined;
  }

  const api: MeasurementDebugApi = {
    dump: getDebugMeasurementDump,
    export: exportDebugMeasurementDump,
    clear: clearDebugMeasurementBuffer,
    status: () => getDebugMeasurementStatus(),
  };
  recordMemorySample();
  const memoryTimer = window.setInterval(recordMemorySample, MEMORY_SAMPLE_INTERVAL_MS);
  window.proliferateDebugMeasurement = api;
  window.__PROLIFERATE_DEBUG_MEASUREMENT__ = api;
  return () => {
    window.clearInterval(memoryTimer);
    if (window.proliferateDebugMeasurement === api) {
      delete window.proliferateDebugMeasurement;
    }
    if (window.__PROLIFERATE_DEBUG_MEASUREMENT__ === api) {
      delete window.__PROLIFERATE_DEBUG_MEASUREMENT__;
    }
  };
}

function getDebugMeasurementStatus(): MeasurementDebugStatus {
  return {
    enabled: {
      mainThread: isMainThreadMeasurementEnabled(),
      anyHarnessTiming: isAnyHarnessTimingEnabled(),
    },
    counts: {
      activeOperations: operations.size,
      pendingCommitMarks: pendingCommitMarks.size,
      categoryBindings: categoryBindings.size,
      recentOperationEvents: recentOperationEvents.length,
      recentMetrics: recentMetrics.length,
      recentMemorySamples: recentMemorySamples.length,
      recentSummaries: recentSummaries.length,
    },
  };
}

function exportDebugMeasurementDump(fileName?: string): MeasurementDebugDump {
  const dump = getDebugMeasurementDump();
  const body = JSON.stringify(dump, null, 2);
  if (typeof window === "undefined" || typeof document === "undefined") {
    console.debug("[measurement_dump_json]", body);
    return dump;
  }

  const blob = new Blob([body], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const safeTimestamp = dump.createdAt.replace(/[:.]/g, "-");
  link.href = url;
  link.download = fileName ?? `proliferate-measurement-dump-${safeTimestamp}.json`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return dump;
}

function recordMetricEvent(
  input: MeasurementMetricInput,
  operationIds: MeasurementOperationId[],
): void {
  pushBounded(recentMetrics, {
    tag: "measurement_metric",
    seq: ++metricEventSeq,
    timestampMs: Date.now(),
    timeOriginMs: getTimeOrigin(),
    operationIds,
    metric: metricSnapshot(input),
  }, RECENT_METRIC_LIMIT);
}

function recordOperationEvent(
  operation: MeasurementOperationRecord,
  phase: "start" | "finish",
  finishReason?: MeasurementFinishReason,
): void {
  pushBounded(recentOperationEvents, {
    tag: "measurement_operation",
    seq: ++operationEventSeq,
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

function recordMemorySample(): void {
  const memory = getMeasurementMemorySnapshot();
  pushBounded(recentMemorySamples, {
    tag: "measurement_memory",
    seq: ++memoryEventSeq,
    timestampMs: Date.now(),
    timeOriginMs: getTimeOrigin(),
    activeOperations: operations.size,
    recentMetrics: recentMetrics.length,
    recentSummaries: recentSummaries.length,
    ...memory,
  }, RECENT_MEMORY_SAMPLE_LIMIT);
}

function metricSnapshot(input: MeasurementMetricInput): MeasurementMetricSnapshot {
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

function operationSnapshot(operation: MeasurementOperationRecord): MeasurementOperationSnapshot {
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

function aggregateSnapshot(a: MeasurementOperationAggregate): MeasurementAggregateSnapshot {
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

function getMeasurementMemorySnapshot(): MeasurementMemorySnapshot {
  if (typeof performance === "undefined") {
    return {
      usedJSHeapSize: null,
      totalJSHeapSize: null,
      jsHeapSizeLimit: null,
    };
  }
  const memory = (performance as Performance & {
    memory?: {
      usedJSHeapSize?: number;
      totalJSHeapSize?: number;
      jsHeapSizeLimit?: number;
    };
  }).memory;
  return {
    usedJSHeapSize: memory?.usedJSHeapSize ?? null,
    totalJSHeapSize: memory?.totalJSHeapSize ?? null,
    jsHeapSizeLimit: memory?.jsHeapSizeLimit ?? null,
  };
}

function getTimeOrigin(): number | null {
  return typeof performance !== "undefined" && typeof performance.timeOrigin === "number"
    ? performance.timeOrigin
    : null;
}

function pushBounded<T>(items: T[], item: T, limit: number): void {
  items.push(item);
  if (items.length > limit) {
    items.splice(0, items.length - limit);
  }
}

function resolveMetricOperationIds(input: MeasurementMetricInput): MeasurementOperationId[] {
  if (input.operationId && operations.has(input.operationId)) {
    return [input.operationId];
  }

  if (input.type === "main_thread") {
    return resolveMainThreadOperationIds(input);
  }

  if (input.type === "diagnostic") {
    // Diagnostics describe ambient render/store work, so attach them to every
    // active operation unless the caller provided a specific operation id.
    return [...operations.keys()];
  }

  if ("category" in input) {
    return resolveBoundOperationIds(
      input.category,
      "runtimeUrlHash" in input ? input.runtimeUrlHash : undefined,
    );
  }

  return [];
}

function resolveMainThreadOperationIds(
  input: Extract<MeasurementMetricInput, { type: "main_thread" }>,
): MeasurementOperationId[] {
  const ids = new Set<MeasurementOperationId>();

  for (const [operationId, surfaces] of pendingCommitMarks) {
    if (surfaces.has(input.surface)) {
      ids.add(operationId);
      surfaces.delete(input.surface);
      if (surfaces.size === 0) {
        pendingCommitMarks.delete(operationId);
      }
    }
  }

  for (const operation of operations.values()) {
    if (
      input.metric === "long_task"
      || input.metric === "frame_gap"
      || operation.surfaces.has(input.surface)
    ) {
      ids.add(operation.id);
    }
  }

  return [...ids];
}

function resolveBoundOperationIds(
  category: MeasurementTimingCategory,
  runtimeUrlHash: string | undefined,
): MeasurementOperationId[] {
  let matched: MeasurementCategoryBinding | null = null;
  const currentTime = now();

  for (const binding of categoryBindings.values()) {
    if (binding.expiresAt <= currentTime) {
      categoryBindings.delete(binding.id);
      continue;
    }
    if (!binding.categories.has(category)) {
      continue;
    }
    if (
      binding.runtimeUrlHash
      && runtimeUrlHash
      && binding.runtimeUrlHash !== runtimeUrlHash
    ) {
      continue;
    }
    if (binding.runtimeUrlHash && !runtimeUrlHash) {
      continue;
    }
    matched = binding;
  }

  return matched && operations.has(matched.operationId) ? [matched.operationId] : [];
}

function applyMetric(
  aggregate: MeasurementOperationAggregate,
  input: MeasurementMetricInput,
): void {
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
  const breakdown = getOrCreate(aggregate.streamBreakdowns, input.phase, () => ({
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

function printSummaryRow(
  operation: MeasurementOperationRecord,
  reason: MeasurementFinishReason,
): void {
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
}

function scheduleOperationTimers(operation: MeasurementOperationRecord): void {
  if (operation.idleTimeoutMs !== null) {
    operation.idleTimer = setTimeout(() => {
      finishMeasurementOperation(operation.id, "idle");
    }, operation.idleTimeoutMs);
  }
  if (operation.maxDurationMs !== null) {
    operation.maxTimer = setTimeout(() => {
      finishMeasurementOperation(operation.id, "max_duration");
    }, operation.maxDurationMs);
  }
}

function cleanupOperation(operation: MeasurementOperationRecord): void {
  clearOperationTimers(operation);
  operations.delete(operation.id);
  pendingCommitMarks.delete(operation.id);
  if (operation.sampleKey) {
    const sampleMapKey = `${operation.kind}:${operation.sampleKey}`;
    if (activeSampleOperations.get(sampleMapKey) === operation.id) {
      activeSampleOperations.delete(sampleMapKey);
    }
    if (operation.cooldownMs > 0) {
      cooldownUntilBySample.set(sampleMapKey, now() + operation.cooldownMs);
    }
  }
  for (const binding of categoryBindings.values()) {
    if (binding.operationId !== operation.id) {
      continue;
    }
    if (binding.timer) {
      clearTimeout(binding.timer);
    }
    categoryBindings.delete(binding.id);
  }
}

function clearOperationTimers(operation: MeasurementOperationRecord): void {
  if (operation.idleTimer) {
    clearTimeout(operation.idleTimer);
    operation.idleTimer = null;
  }
  if (operation.maxTimer) {
    clearTimeout(operation.maxTimer);
    operation.maxTimer = null;
  }
}

function mergeMeasurementHeader(
  headers: HeadersInit | undefined,
  operationId: MeasurementOperationId,
): Headers {
  const next = new Headers(headers);
  next.set(MEASUREMENT_HEADER, operationId);
  return next;
}

function createEmptyAggregate(): MeasurementOperationAggregate {
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

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
