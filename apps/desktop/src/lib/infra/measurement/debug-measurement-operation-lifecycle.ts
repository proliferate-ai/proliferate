import {
  activeSampleOperations,
  categoryBindings,
  cooldownUntilBySample,
  operationFinishListeners,
  operations,
  pendingCommitMarks,
} from "./debug-measurement-state";
import type {
  MeasurementFinishReason,
} from "./debug-measurement-catalog-types";
import type {
  MeasurementOperationRecord,
} from "./debug-measurement-registry-types";
import { now } from "./debug-measurement-utils";

type FinishMeasurementOperation = (
  id: MeasurementOperationRecord["id"],
  reason: MeasurementFinishReason,
) => void;

export function scheduleOperationTimers(
  operation: MeasurementOperationRecord,
  finishMeasurementOperation: FinishMeasurementOperation,
): void {
  scheduleOperationIdleTimer(operation, finishMeasurementOperation);
  if (operation.maxDurationMs !== null) {
    operation.maxTimer = setTimeout(() => {
      finishMeasurementOperation(operation.id, "max_duration");
    }, operation.maxDurationMs);
  }
}

export function scheduleOperationIdleTimer(
  operation: MeasurementOperationRecord,
  finishMeasurementOperation: FinishMeasurementOperation,
): void {
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

export function notifyOperationFinish(
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

export function cleanupOperation(
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

export function clearOperationTimers(operation: MeasurementOperationRecord): void {
  if (operation.idleTimer) {
    clearTimeout(operation.idleTimer);
    operation.idleTimer = null;
  }
  if (operation.maxTimer) {
    clearTimeout(operation.maxTimer);
    operation.maxTimer = null;
  }
}
