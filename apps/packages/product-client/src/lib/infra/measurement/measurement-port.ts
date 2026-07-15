import type {
  AnyHarnessMeasurementOperationId,
  AnyHarnessRequestOptions,
  AnyHarnessTimingCategory,
} from "@anyharness/sdk";

/**
 * Product-owned measurement port (WDU slice 04, ruling R1).
 *
 * The moved product tree calls the Desktop diagnostics/measurement subsystem in
 * ~170 hot-path sites. That subsystem stays host-retained (in the Desktop host's
 * `lib/infra/measurement` tree) and is deliberately NOT a `ProductHost` capability — it
 * is dev-only instrumentation. This module is the single seam the moved code
 * imports instead: it re-exposes exactly the functions/types those call sites
 * use (identical names, so call sites change only their import path) and routes
 * every call through a swappable {@link MeasurementSink}.
 *
 * The default sink is a type-safe no-op. Desktop injects its concrete retained
 * implementation once, at module scope of `DesktopHostProviders`, before
 * `ProductClient` renders — so Desktop behavior is byte-identical to before the
 * move. The package test lane injects the same retained implementation through a
 * setup file. Web (later) leaves the no-op default in place: measurement off.
 *
 * This file holds no measurement logic — only the contract types, the sink, and
 * thin delegators — so there is no logic duplicated from the retained engine.
 */

// --- Contract types (product-owned copies of the retained measurement types) ---
// Kept structurally identical to `apps/desktop/src/lib/infra/measurement`'s
// `debug-measurement-catalog-types` / `-metric-types` / `-registry-types` /
// `latency-flow` / `debug-session-activity` so the retained concrete functions
// are assignable to {@link MeasurementSink} at the Desktop/test injection sites.

export type MeasurementOperationId = AnyHarnessMeasurementOperationId;
export type MeasurementOperationKind = string;
export type MeasurementSurface = string;
export type MeasurementSampleKey = string;
export type MeasurementTimingCategory = string;
export type MeasurementWorkflowStep = string;
export type MeasurementStateCountTarget = string;

export type MeasurementFinishReason =
  | "completed"
  | "idle"
  | "max_duration"
  | "unmount"
  | "navigation"
  | "aborted"
  | "disabled"
  | "error_sanitized";

export type MeasurementWorkflowOutcome =
  | "completed"
  | "skipped"
  | "cache_hit"
  | "cache_miss"
  | "error_sanitized";

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

export type MeasurementOperationFinishListener = (input: {
  operationId: MeasurementOperationId;
  reason: MeasurementFinishReason;
}) => void;

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
      category: MeasurementTimingCategory;
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
      startedAtMs?: number;
      endedAtMs?: number;
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

export type LatencyFlowKind =
  | "prompt_submit"
  | "session_create"
  | "session_restore"
  | "session_switch"
  | "workspace_switch"
  | "cloud_workspace_create"
  | "worktree_enter";

export type LatencyFlowStage =
  | "intent"
  | "optimistic_visible"
  | "processing_started"
  | "surface_ready"
  | "live_attached"
  | "failed"
  | "cancelled";

export interface StartLatencyFlowInput {
  flowKind: LatencyFlowKind;
  source?: string | null;
  targetWorkspaceId?: string | null;
  targetSessionId?: string | null;
  attemptId?: string | null;
  promptId?: string | null;
}

export interface AnnotateLatencyFlowInput {
  source?: string | null;
  targetWorkspaceId?: string | null;
  targetSessionId?: string | null;
  attemptId?: string | null;
  promptId?: string | null;
}

export interface LatencyFlowRecord {
  flowId: string;
  flowKind: LatencyFlowKind;
  startedAt: number;
  source: string | null;
  targetWorkspaceId: string | null;
  targetSessionId: string | null;
  attemptId: string | null;
  promptId: string | null;
  completedStages: ReadonlySet<LatencyFlowStage>;
}

export interface SessionActivityDebugSnapshot {
  viewState: string;
  executionPhase: string | null;
  status: string | null;
  transcriptIsStreaming: boolean;
  streamConnectionState: string | null;
  pendingInteractionCount: number;
  executionSummaryUpdatedAt: string | null;
}

/**
 * The subset of the retained measurement debug dump the moved product tree reads
 * (arrays it asserts lengths on / serializes). The retained concrete dump is a
 * superset and remains assignable here.
 */
export interface MeasurementDebugDump {
  recentMetrics: readonly unknown[];
  activeOperations: readonly unknown[];
  recentDebugActivities: readonly unknown[];
}

// --- The sink ----------------------------------------------------------------

/**
 * Every measurement function the moved product tree calls, grouped by their
 * retained source module. Method signatures mirror the retained concrete
 * functions so `setMeasurementSink(retainedImplementation)` type-checks
 * structurally. The default implementation is a no-op.
 */
export interface MeasurementSink {
  // boot-stall-diagnostics
  recordBootDiagnostic(label: string, metadata?: Record<string, unknown>): void;
  recordBootDiagnosticOnce(
    label: string,
    metadata?: Record<string, unknown>,
  ): void;
  isBootDiagnosticsBrowserFlagEnabled(): boolean;

  // debug-jank-activity
  recordStoreActionDebugActivity(input: {
    label: string;
    startedAtMs?: number | null;
    endedAtMs?: number | null;
    durationMs?: number | null;
    metadata?: Record<string, unknown>;
  }): unknown;

  // debug-latency
  elapsedMs(startedAt: number): number;
  elapsedSince(createdAt: number): number;
  logLatency(event: string, fields?: Record<string, unknown>): void;
  startLatencyTimer(): number;

  // debug-measurement
  bindMeasurementCategories(input: MeasurementCategoryBindingInput): () => void;
  finishMeasurementOperation(
    id: MeasurementOperationId,
    reason: MeasurementFinishReason,
  ): void;
  finishOrCancelMeasurementOperation(
    id: MeasurementOperationId | null | undefined,
    reason: MeasurementFinishReason,
  ): void;
  markOperationForNextCommit(
    id: MeasurementOperationId,
    surfaces: readonly MeasurementSurface[],
  ): void;
  measureDebugComputation<T>(
    input: {
      category: string;
      label: string;
      operationId?: MeasurementOperationId | null;
      keys?: readonly string[];
      count?: (value: T) => number | undefined;
    },
    compute: () => T,
  ): T;
  onMeasurementOperationFinish(
    id: MeasurementOperationId,
    listener: MeasurementOperationFinishListener,
  ): () => void;
  recordMeasurementDiagnostic(input: {
    category: string;
    label: string;
    operationId?: MeasurementOperationId | null;
    startedAt?: number;
    durationMs?: number;
    count?: number;
    keys?: readonly string[];
    detail?: string | null;
  }): void;
  recordMeasurementMetric(input: MeasurementMetricInput): void;
  recordMeasurementWorkflowStep(input: {
    operationId?: MeasurementOperationId | null;
    step: MeasurementWorkflowStep;
    startedAt: number;
    outcome?: MeasurementWorkflowOutcome;
    count?: number;
  }): void;
  resetDebugMeasurementForTest(): void;
  startMeasurementOperation(input: {
    kind: MeasurementOperationKind;
    surfaces: readonly MeasurementSurface[];
    sampleKey?: MeasurementSampleKey;
    linkedLatencyFlowId?: string;
    idleTimeoutMs?: number;
    maxDurationMs?: number;
    cooldownMs?: number;
    summaryBudget?: MeasurementSummaryBudget | null;
  }): MeasurementOperationId | null;

  // debug-measurement-dump
  getDebugMeasurementDump(): MeasurementDebugDump;

  // debug-measurement-env
  hashMeasurementScope(value: string): string;
  isAnyHarnessTimingEnabled(): boolean;
  isDebugMeasurementEnabled(): boolean;
  isMainThreadMeasurementEnabled(): boolean;

  // debug-measurement-request-options
  getMeasurementRequestOptions(input: {
    operationId?: MeasurementOperationId | null;
    category: AnyHarnessTimingCategory;
    headers?: HeadersInit;
  }): AnyHarnessRequestOptions | undefined;

  // debug-measurement-utils
  envFlagEnabled(
    value: string | boolean | undefined,
    defaultValue?: boolean,
  ): boolean;
  now(): number;
  round(value: number): number;

  // debug-session-activity
  forgetSessionActivityDebugState(sessionId: string): void;
  isSessionActivityDebugLoggingEnabled(): boolean;
  logSessionActivityTransition(
    sessionId: string,
    next: SessionActivityDebugSnapshot,
  ): void;

  // debug-startup
  elapsedStartupMs(startedAt: number): number;
  logStartupDebug(event: string, fields?: Record<string, unknown>): void;
  startStartupTimer(): number;
  summarizeStartupError(error: unknown): Record<string, unknown>;

  // latency-flow
  annotateLatencyFlow(
    flowId: string | null | undefined,
    input: AnnotateLatencyFlowInput,
  ): void;
  cancelLatencyFlow(
    flowId: string | null | undefined,
    reason: string,
    extraFields?: Record<string, unknown>,
  ): void;
  failLatencyFlow(
    flowId: string | null | undefined,
    reason: string,
    extraFields?: Record<string, unknown>,
  ): void;
  finishLatencyFlow(
    flowId: string | null | undefined,
    stage: Exclude<LatencyFlowStage, "intent" | "failed" | "cancelled">,
    options?: {
      keepActive?: boolean;
      reason?: string | null;
      extraFields?: Record<string, unknown>;
    },
  ): boolean;
  getLatencyFlowRequestHeaders(
    flowId: string | null | undefined,
  ): HeadersInit | undefined;
  listActiveLatencyFlows(): LatencyFlowRecord[];
  markLatencyFlowLiveAttached(sessionId: string): void;
  resetLatencyFlowsForTest(): void;
  startLatencyFlow(input: StartLatencyFlowInput): string;

  // operation-ids
  uniqueMeasurementOperationIds(
    operationIds: readonly (MeasurementOperationId | null | undefined)[],
  ): MeasurementOperationId[];

  // typing-latency-probe
  recordTypingKeystrokeLatency(input: {
    operationId: MeasurementOperationId | null;
    surface: MeasurementSurface;
    eventTimeStampMs: number | null | undefined;
  }): void;
}

const noopMeasurementSink: MeasurementSink = {
  recordBootDiagnostic: () => undefined,
  recordBootDiagnosticOnce: () => undefined,
  isBootDiagnosticsBrowserFlagEnabled: () => false,
  recordStoreActionDebugActivity: () => null,
  elapsedMs: () => 0,
  elapsedSince: () => 0,
  logLatency: () => undefined,
  startLatencyTimer: () => 0,
  bindMeasurementCategories: () => () => undefined,
  finishMeasurementOperation: () => undefined,
  finishOrCancelMeasurementOperation: () => undefined,
  markOperationForNextCommit: () => undefined,
  measureDebugComputation: (_input, compute) => compute(),
  onMeasurementOperationFinish: () => () => undefined,
  recordMeasurementDiagnostic: () => undefined,
  recordMeasurementMetric: () => undefined,
  recordMeasurementWorkflowStep: () => undefined,
  resetDebugMeasurementForTest: () => undefined,
  startMeasurementOperation: () => null,
  getDebugMeasurementDump: () => ({
    recentMetrics: [],
    activeOperations: [],
    recentDebugActivities: [],
  }),
  hashMeasurementScope: (value) => value,
  isAnyHarnessTimingEnabled: () => false,
  isDebugMeasurementEnabled: () => false,
  isMainThreadMeasurementEnabled: () => false,
  getMeasurementRequestOptions: (input) =>
    input.headers ? { headers: input.headers } : undefined,
  envFlagEnabled: (_value, defaultValue = false) => defaultValue,
  now: () =>
    typeof performance !== "undefined" ? performance.now() : Date.now(),
  round: (value) => Math.round(value * 100) / 100,
  forgetSessionActivityDebugState: () => undefined,
  isSessionActivityDebugLoggingEnabled: () => false,
  logSessionActivityTransition: () => undefined,
  elapsedStartupMs: () => 0,
  logStartupDebug: () => undefined,
  startStartupTimer: () => 0,
  summarizeStartupError: () => ({}),
  annotateLatencyFlow: () => undefined,
  cancelLatencyFlow: () => undefined,
  failLatencyFlow: () => undefined,
  finishLatencyFlow: () => false,
  getLatencyFlowRequestHeaders: () => undefined,
  listActiveLatencyFlows: () => [],
  markLatencyFlowLiveAttached: () => undefined,
  resetLatencyFlowsForTest: () => undefined,
  startLatencyFlow: () => "",
  uniqueMeasurementOperationIds: () => [],
  recordTypingKeystrokeLatency: () => undefined,
};

let sink: MeasurementSink = noopMeasurementSink;

/**
 * Install the concrete measurement implementation. Desktop calls this once at
 * `DesktopHostProviders` module scope with its retained engine; the package test
 * lane calls it in a setup file. Idempotent: last writer wins.
 */
export function setMeasurementSink(next: MeasurementSink): void {
  sink = next;
}

/** Restore the no-op default. Exposed for symmetry / test teardown. */
export function resetMeasurementSink(): void {
  sink = noopMeasurementSink;
}

// --- Delegators (identical names to the retained modules) --------------------

export function recordBootDiagnostic(
  label: string,
  metadata?: Record<string, unknown>,
): void {
  sink.recordBootDiagnostic(label, metadata);
}
export function recordBootDiagnosticOnce(
  label: string,
  metadata?: Record<string, unknown>,
): void {
  sink.recordBootDiagnosticOnce(label, metadata);
}
export function isBootDiagnosticsBrowserFlagEnabled(): boolean {
  return sink.isBootDiagnosticsBrowserFlagEnabled();
}

export function recordStoreActionDebugActivity(input: {
  label: string;
  startedAtMs?: number | null;
  endedAtMs?: number | null;
  durationMs?: number | null;
  metadata?: Record<string, unknown>;
}): unknown {
  return sink.recordStoreActionDebugActivity(input);
}

export function elapsedMs(startedAt: number): number {
  return sink.elapsedMs(startedAt);
}
export function elapsedSince(createdAt: number): number {
  return sink.elapsedSince(createdAt);
}
export function logLatency(
  event: string,
  fields?: Record<string, unknown>,
): void {
  sink.logLatency(event, fields);
}
export function startLatencyTimer(): number {
  return sink.startLatencyTimer();
}

export function bindMeasurementCategories(
  input: MeasurementCategoryBindingInput,
): () => void {
  return sink.bindMeasurementCategories(input);
}
export function finishMeasurementOperation(
  id: MeasurementOperationId,
  reason: MeasurementFinishReason,
): void {
  sink.finishMeasurementOperation(id, reason);
}
export function finishOrCancelMeasurementOperation(
  id: MeasurementOperationId | null | undefined,
  reason: MeasurementFinishReason,
): void {
  sink.finishOrCancelMeasurementOperation(id, reason);
}
export function markOperationForNextCommit(
  id: MeasurementOperationId,
  surfaces: readonly MeasurementSurface[],
): void {
  sink.markOperationForNextCommit(id, surfaces);
}
export function measureDebugComputation<T>(
  input: {
    category: string;
    label: string;
    operationId?: MeasurementOperationId | null;
    keys?: readonly string[];
    count?: (value: T) => number | undefined;
  },
  compute: () => T,
): T {
  return sink.measureDebugComputation(input, compute);
}
export function onMeasurementOperationFinish(
  id: MeasurementOperationId,
  listener: MeasurementOperationFinishListener,
): () => void {
  return sink.onMeasurementOperationFinish(id, listener);
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
  sink.recordMeasurementDiagnostic(input);
}
export function recordMeasurementMetric(input: MeasurementMetricInput): void {
  sink.recordMeasurementMetric(input);
}
export function recordMeasurementWorkflowStep(input: {
  operationId?: MeasurementOperationId | null;
  step: MeasurementWorkflowStep;
  startedAt: number;
  outcome?: MeasurementWorkflowOutcome;
  count?: number;
}): void {
  sink.recordMeasurementWorkflowStep(input);
}
export function resetDebugMeasurementForTest(): void {
  sink.resetDebugMeasurementForTest();
}
export function startMeasurementOperation(input: {
  kind: MeasurementOperationKind;
  surfaces: readonly MeasurementSurface[];
  sampleKey?: MeasurementSampleKey;
  linkedLatencyFlowId?: string;
  idleTimeoutMs?: number;
  maxDurationMs?: number;
  cooldownMs?: number;
  summaryBudget?: MeasurementSummaryBudget | null;
}): MeasurementOperationId | null {
  return sink.startMeasurementOperation(input);
}

export function getDebugMeasurementDump(): MeasurementDebugDump {
  return sink.getDebugMeasurementDump();
}

export function hashMeasurementScope(value: string): string {
  return sink.hashMeasurementScope(value);
}
export function isAnyHarnessTimingEnabled(): boolean {
  return sink.isAnyHarnessTimingEnabled();
}
export function isDebugMeasurementEnabled(): boolean {
  return sink.isDebugMeasurementEnabled();
}
export function isMainThreadMeasurementEnabled(): boolean {
  return sink.isMainThreadMeasurementEnabled();
}

export function getMeasurementRequestOptions(input: {
  operationId?: MeasurementOperationId | null;
  category: AnyHarnessTimingCategory;
  headers?: HeadersInit;
}): AnyHarnessRequestOptions | undefined {
  return sink.getMeasurementRequestOptions(input);
}

export function envFlagEnabled(
  value: string | boolean | undefined,
  defaultValue = false,
): boolean {
  return sink.envFlagEnabled(value, defaultValue);
}
export function now(): number {
  return sink.now();
}
export function round(value: number): number {
  return sink.round(value);
}

export function forgetSessionActivityDebugState(sessionId: string): void {
  sink.forgetSessionActivityDebugState(sessionId);
}
export function isSessionActivityDebugLoggingEnabled(): boolean {
  return sink.isSessionActivityDebugLoggingEnabled();
}
export function logSessionActivityTransition(
  sessionId: string,
  next: SessionActivityDebugSnapshot,
): void {
  sink.logSessionActivityTransition(sessionId, next);
}

export function elapsedStartupMs(startedAt: number): number {
  return sink.elapsedStartupMs(startedAt);
}
export function logStartupDebug(
  event: string,
  fields?: Record<string, unknown>,
): void {
  sink.logStartupDebug(event, fields);
}
export function startStartupTimer(): number {
  return sink.startStartupTimer();
}
export function summarizeStartupError(error: unknown): Record<string, unknown> {
  return sink.summarizeStartupError(error);
}

export function annotateLatencyFlow(
  flowId: string | null | undefined,
  input: AnnotateLatencyFlowInput,
): void {
  sink.annotateLatencyFlow(flowId, input);
}
export function cancelLatencyFlow(
  flowId: string | null | undefined,
  reason: string,
  extraFields?: Record<string, unknown>,
): void {
  sink.cancelLatencyFlow(flowId, reason, extraFields);
}
export function failLatencyFlow(
  flowId: string | null | undefined,
  reason: string,
  extraFields?: Record<string, unknown>,
): void {
  sink.failLatencyFlow(flowId, reason, extraFields);
}
export function finishLatencyFlow(
  flowId: string | null | undefined,
  stage: Exclude<LatencyFlowStage, "intent" | "failed" | "cancelled">,
  options?: {
    keepActive?: boolean;
    reason?: string | null;
    extraFields?: Record<string, unknown>;
  },
): boolean {
  return sink.finishLatencyFlow(flowId, stage, options);
}
export function getLatencyFlowRequestHeaders(
  flowId: string | null | undefined,
): HeadersInit | undefined {
  return sink.getLatencyFlowRequestHeaders(flowId);
}
export function listActiveLatencyFlows(): LatencyFlowRecord[] {
  return sink.listActiveLatencyFlows();
}
export function markLatencyFlowLiveAttached(sessionId: string): void {
  sink.markLatencyFlowLiveAttached(sessionId);
}
export function resetLatencyFlowsForTest(): void {
  sink.resetLatencyFlowsForTest();
}
export function startLatencyFlow(input: StartLatencyFlowInput): string {
  return sink.startLatencyFlow(input);
}

export function uniqueMeasurementOperationIds(
  operationIds: readonly (MeasurementOperationId | null | undefined)[],
): MeasurementOperationId[] {
  return sink.uniqueMeasurementOperationIds(operationIds);
}

export function recordTypingKeystrokeLatency(input: {
  operationId: MeasurementOperationId | null;
  surface: MeasurementSurface;
  eventTimeStampMs: number | null | undefined;
}): void {
  sink.recordTypingKeystrokeLatency(input);
}
