import { recordMeasurementDiagnostic } from "@/lib/infra/measurement/debug-measurement";
import { isDebugMeasurementEnabled } from "@/lib/infra/measurement/debug-measurement-env";
import { recordDebugActivity } from "@/lib/infra/measurement/debug-jank-activity";
import { operations } from "@/lib/infra/measurement/debug-measurement-state";
import type { MeasurementOperationId } from "@/lib/infra/measurement/debug-measurement-catalog-types";

export function recordDebugActionDiagnostic({
  category,
  label,
  keys,
  detail,
  operationIds,
}: {
  category: string;
  label: string;
  keys?: readonly string[];
  detail?: Record<string, unknown>;
  operationIds?: readonly MeasurementOperationId[];
}): void {
  if (!isDebugMeasurementEnabled()) {
    return;
  }

  const startedAtMs = performance.now();
  const stack = captureActionStack();
  const resolvedOperationIds = operationIds ?? [...operations.keys()];
  recordDebugActivity({
    kind: "store_action",
    label: `${category}.${label}`,
    startedAtMs,
    endedAtMs: startedAtMs,
    durationMs: 0,
    operationIds: resolvedOperationIds,
    metadata: {
      category,
      keys: keys ?? [],
      detail: detail ?? null,
      stack,
    },
  });
  recordMeasurementDiagnostic({
    category,
    label,
    keys,
    count: keys?.length,
    detail: JSON.stringify({
      ...detail,
      stack,
    }),
  });
}

export function recordDebugStoreTransition<State extends object>({
  category,
  label,
  before,
  after,
  detail,
}: {
  category: string;
  label: string;
  before: State;
  after: Partial<State> | State;
  detail?: Record<string, unknown>;
}): void {
  if (!isDebugMeasurementEnabled()) {
    return;
  }

  const mergedAfter = { ...before, ...after };
  const changedKeys = collectChangedTopLevelKeys(before, mergedAfter);
  recordDebugActionDiagnostic({
    category,
    label,
    keys: changedKeys,
    detail: {
      ...detail,
      changedKeys,
      changedKeyCount: changedKeys.length,
      changedValues: summarizeChangedValues(before, mergedAfter, changedKeys),
    },
  });
}

function collectChangedTopLevelKeys<State extends object>(
  before: State,
  after: Partial<State> | State,
): string[] {
  const beforeRecord = before as Record<string, unknown>;
  const afterRecord = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]);
  return [...keys].filter((key) => !Object.is(beforeRecord[key], afterRecord[key]));
}

function summarizeChangedValues<State extends object>(
  before: State,
  after: Partial<State> | State,
  keys: readonly string[],
): Record<string, { before: DebugValueSummary; after: DebugValueSummary }> {
  const summary: Record<string, { before: DebugValueSummary; after: DebugValueSummary }> = {};
  const beforeRecord = before as Record<string, unknown>;
  const afterRecord = after as Record<string, unknown>;
  for (const key of keys.slice(0, 16)) {
    summary[key] = {
      before: summarizeDebugValue(beforeRecord[key]),
      after: summarizeDebugValue(afterRecord[key]),
    };
  }
  return summary;
}

type DebugValueSummary =
  | { kind: "array"; length: number }
  | { kind: "object"; keyCount: number; keys: string[] }
  | { kind: "map"; size: number }
  | { kind: "set"; size: number }
  | { kind: "null" }
  | { kind: "primitive"; valueType: string; value: string | number | boolean | null };

function summarizeDebugValue(value: unknown): DebugValueSummary {
  if (value === null || value === undefined) {
    return { kind: "null" };
  }
  if (Array.isArray(value)) {
    return { kind: "array", length: value.length };
  }
  if (value instanceof Map) {
    return { kind: "map", size: value.size };
  }
  if (value instanceof Set) {
    return { kind: "set", size: value.size };
  }
  const valueType = typeof value;
  if (valueType === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return { kind: "object", keyCount: keys.length, keys: keys.slice(0, 12) };
  }
  if (valueType === "string") {
    const text = value as string;
    return {
      kind: "primitive",
      valueType,
      value: text.length > 80 ? `${text.slice(0, 80)}...` : text,
    };
  }
  if (valueType === "number" || valueType === "boolean") {
    return { kind: "primitive", valueType, value: value as number | boolean };
  }
  return { kind: "primitive", valueType, value: String(value).slice(0, 80) };
}

function captureActionStack(): string[] {
  const stack = new Error().stack;
  if (!stack) {
    return [];
  }
  return stack
    .split("\n")
    .slice(2)
    .map((line) => line.trim())
    .filter((line) =>
      line.length > 0
      && !line.includes("debug-action-diagnostic")
      && !line.includes("debug-measurement")
    )
    .slice(0, 8);
}
