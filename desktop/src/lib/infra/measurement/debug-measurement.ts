import {
  hashTimingScope,
  type AnyHarnessRequestOptions,
  type AnyHarnessTimingCategory,
} from "@anyharness/sdk";
import { applyMetric, createEmptyAggregate } from "./debug-measurement-aggregate";
import { isHotPaintOperationKind, printSummaryRow } from "./debug-measurement-summary";
import { metricSnapshot, operationSnapshot } from "./debug-measurement-snapshots";
import type {
  MeasurementCategoryBinding,
  MeasurementCategoryBindingInput,
  MeasurementDebugApi,
  MeasurementDebugDump,
  MeasurementDebugStatus,
  MeasurementFinishReason,
  MeasurementMemoryEvent,
  MeasurementMetricEvent,
  MeasurementMetricInput,
  MeasurementOperationEvent,
  MeasurementOperationFinishListener,
  MeasurementOperationId,
  MeasurementOperationKind,
  MeasurementOperationRecord,
  MeasurementSampleKey,
  MeasurementSummaryPayload,
  MeasurementSurface,
  MeasurementTimingCategory,
  MeasurementWorkflowOutcome,
  MeasurementWorkflowStep,
} from "./debug-measurement-types";
import {
  envFlagEnabled,
  getMeasurementMemorySnapshot,
  getTimeOrigin,
  now,
  pushBounded,
  round,
} from "./debug-measurement-utils";

export type {
  MeasurementCategoryBindingInput,
  MeasurementCloudCategory,
  MeasurementDebugApi,
  MeasurementDebugDump,
  MeasurementDebugStatus,
  MeasurementFinishReason,
  MeasurementMetricInput,
  MeasurementOperationId,
  MeasurementOperationKind,
  MeasurementSampleKey,
  MeasurementStateCountTarget,
  MeasurementSurface,
  MeasurementTimingCategory,
  MeasurementWorkflowOutcome,
  MeasurementWorkflowStep,
} from "./debug-measurement-types";

// Dev-only measurement plumbing. Collection is disabled unless the Vite dev
// build sets VITE_PROLIFERATE_DEBUG_MAIN_THREAD=1 or
// VITE_PROLIFERATE_DEBUG_ANYHARNESS_TIMING=1; emitted records are limited to
// ids, counts, durations, categories, and hashed scopes.

const MEASUREMENT_HEADER = "x-proliferate-measurement-operation-id";
// Diagnostic sessions can generate many short-lived events; this buffer is
// still dev-only because recordMeasurementMetric exits when measurement is off.
const RECENT_METRIC_LIMIT = 50_000;
const RECENT_OPERATION_EVENT_LIMIT = 1_000;
const RECENT_MEMORY_SAMPLE_LIMIT = 1_000;
const MEMORY_SAMPLE_INTERVAL_MS = 5_000;
const operations = new Map<MeasurementOperationId, MeasurementOperationRecord>();
const activeSampleOperations = new Map<string, MeasurementOperationId>();
const cooldownUntilBySample = new Map<string, number>();
const pendingCommitMarks = new Map<MeasurementOperationId, Set<MeasurementSurface>>();
const categoryBindings = new Map<string, MeasurementCategoryBinding>();
const operationFinishListeners = new Map<MeasurementOperationId, Set<MeasurementOperationFinishListener>>();
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
    inFlightRequestCount: 0,
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
  scheduleOperationIdleTimer(operation);
}

export function beginMeasurementRequest(
  id: MeasurementOperationId | null | undefined,
): () => void {
  if (!id || !isDebugMeasurementEnabled()) {
    return () => undefined;
  }

  const operation = operations.get(id);
  if (!operation) {
    return () => undefined;
  }

  operation.inFlightRequestCount += 1;
  if (operation.idleTimer) {
    clearTimeout(operation.idleTimer);
    operation.idleTimer = null;
  }

  let finished = false;
  return () => {
    if (finished) {
      return;
    }
    finished = true;
    const current = operations.get(id);
    if (!current) {
      return;
    }
    current.inFlightRequestCount = Math.max(0, current.inFlightRequestCount - 1);
    scheduleOperationIdleTimer(current);
  };
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
  notifyOperationFinish(operation, reason);
  cleanupOperation(operation, reason);
  if (operation.hasMetrics || isHotPaintOperationKind(operation.kind)) {
    printSummaryRow({ operation, reason, longTaskObserverSupported, recentSummaries });
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
  notifyOperationFinish(operation, reason);
  cleanupOperation(operation, reason);
  if (operation.hasMetrics || isHotPaintOperationKind(operation.kind)) {
    printSummaryRow({ operation, reason, longTaskObserverSupported, recentSummaries });
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

export function onMeasurementOperationFinish(
  id: MeasurementOperationId,
  listener: MeasurementOperationFinishListener,
): () => void {
  let listeners = operationFinishListeners.get(id);
  if (!listeners) {
    listeners = new Set();
    operationFinishListeners.set(id, listeners);
  }
  listeners.add(listener);
  return () => {
    const current = operationFinishListeners.get(id);
    if (!current) {
      return;
    }
    current.delete(listener);
    if (current.size === 0) {
      operationFinishListeners.delete(id);
    }
  };
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
    options.timingLifecycle = {
      onRequestStart: () => beginMeasurementRequest(input.operationId),
    };
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
    operation.hasMetrics = true;
    applyMetric(operation, input);
    touchMeasurementOperation(operation.id);
  }
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
  operationId?: MeasurementOperationId | null;
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
    operationId: input.operationId,
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
  operationFinishListeners.clear();
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

function resolveMetricOperationIds(input: MeasurementMetricInput): MeasurementOperationId[] {
  if (input.operationId) {
    return operations.has(input.operationId) ? [input.operationId] : [];
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

function scheduleOperationTimers(operation: MeasurementOperationRecord): void {
  scheduleOperationIdleTimer(operation);
  if (operation.maxDurationMs !== null) {
    operation.maxTimer = setTimeout(() => {
      finishMeasurementOperation(operation.id, "max_duration");
    }, operation.maxDurationMs);
  }
}

function scheduleOperationIdleTimer(operation: MeasurementOperationRecord): void {
  if (operation.idleTimer) {
    clearTimeout(operation.idleTimer);
    operation.idleTimer = null;
  }
  if (operation.idleTimeoutMs === null || operation.inFlightRequestCount > 0) {
    return;
  }
  operation.idleTimer = setTimeout(() => {
    finishMeasurementOperation(operation.id, "idle");
  }, operation.idleTimeoutMs);
}

function notifyOperationFinish(
  operation: MeasurementOperationRecord,
  reason: MeasurementFinishReason,
): void {
  const listeners = operationFinishListeners.get(operation.id);
  if (!listeners) {
    return;
  }
  operationFinishListeners.delete(operation.id);
  for (const listener of [...listeners]) {
    try {
      listener({ operationId: operation.id, reason });
    } catch {
      console.error("[debug-measurement] operation finish listener failed", {
        operationId: operation.id,
        operationKind: operation.kind,
      });
    }
  }
}

function cleanupOperation(
  operation: MeasurementOperationRecord,
  reason: MeasurementFinishReason,
): void {
  clearOperationTimers(operation);
  operations.delete(operation.id);
  pendingCommitMarks.delete(operation.id);
  operationFinishListeners.delete(operation.id);
  if (operation.sampleKey) {
    const sampleMapKey = `${operation.kind}:${operation.sampleKey}`;
    if (activeSampleOperations.get(sampleMapKey) === operation.id) {
      activeSampleOperations.delete(sampleMapKey);
    }
    if (operation.cooldownMs > 0 && reason !== "unmount") {
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
