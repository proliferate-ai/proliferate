import { applyMetric, createEmptyAggregate } from "./debug-measurement-aggregate";
import { clearDebugMeasurementBuffer, recordMetricEvent, recordOperationEvent } from "./debug-measurement-events";
import { isDebugMeasurementEnabled, isMainThreadMeasurementEnabled } from "./debug-measurement-env";
import {
  clearDebugJankBuffers,
  recordMetricDebugActivity,
} from "./debug-jank-activity";
import {
  getLongTaskObserverSupportedForMeasurement,
  resetLongTaskObserverSupportForTest,
} from "./debug-measurement-observer";
import { printSummaryRow } from "./debug-measurement-summary";
import {
  activeSampleOperations,
  categoryBindings,
  cooldownUntilBySample,
  nextMeasurementBindingId,
  nextMeasurementOperationId,
  operationFinishListeners,
  operations,
  pendingCommitMarks,
  recentSummaries,
  resetMeasurementSequencesForTest,
} from "./debug-measurement-state";
import type {
  MeasurementFinishReason,
  MeasurementOperationId,
  MeasurementOperationKind,
  MeasurementSampleKey,
  MeasurementSurface,
  MeasurementTimingCategory,
  MeasurementWorkflowOutcome,
  MeasurementWorkflowStep,
} from "./debug-measurement-catalog-types";
import type { MeasurementMetricInput } from "./debug-measurement-metric-types";
import type {
  MeasurementCategoryBinding,
  MeasurementCategoryBindingInput,
  MeasurementOperationFinishListener,
  MeasurementOperationRecord,
  MeasurementSummaryBudget,
} from "./debug-measurement-registry-types";
import { now } from "./debug-measurement-utils";

// Dev-only measurement plumbing. Collection is disabled unless the Vite dev
// build sets VITE_PROLIFERATE_DEBUG_MAIN_THREAD=1 or
// VITE_PROLIFERATE_DEBUG_ANYHARNESS_TIMING=1; emitted records are limited to
// ids, counts, durations, categories, and hashed scopes.

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

  const id = nextMeasurementOperationId();
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
    summaryBudget: input.summaryBudget ?? null,
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
  if (operation.hasMetrics || operation.summaryBudget) {
    printSummaryRow({
      operation,
      reason,
      longTaskObserverSupported: getLongTaskObserverSupportedForMeasurement(),
      recentSummaries,
    });
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
  if (operation.hasMetrics || operation.summaryBudget) {
    printSummaryRow({
      operation,
      reason,
      longTaskObserverSupported: getLongTaskObserverSupportedForMeasurement(),
      recentSummaries,
    });
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

export function bindMeasurementCategories(input: MeasurementCategoryBindingInput): () => void {
  if (!isDebugMeasurementEnabled() || !operations.has(input.operationId)) {
    return () => undefined;
  }
  const id = nextMeasurementBindingId();
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
  recordMetricDebugActivity(input, operationIds);
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
  clearDebugJankBuffers();
  resetMeasurementSequencesForTest();
  resetLongTaskObserverSupportForTest();
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
