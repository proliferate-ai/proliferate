import {
  categoryBindings,
  operations,
  pendingCommitMarks,
} from "./debug-measurement-state";
import type {
  MeasurementOperationId,
  MeasurementTimingCategory,
} from "./debug-measurement-catalog-types";
import type { MeasurementMetricInput } from "./debug-measurement-metric-types";
import type {
  MeasurementCategoryBinding,
} from "./debug-measurement-registry-types";
import { now } from "./debug-measurement-utils";

export function resolveMetricOperationIds(input: MeasurementMetricInput): MeasurementOperationId[] {
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
