import { useEffect, useRef } from "react";
import { recordMeasurementDiagnostic } from "@/lib/infra/measurement/debug-measurement";
import { isDebugMeasurementEnabled } from "@/lib/infra/measurement/debug-measurement-env";

type DebugValueMap = Record<string, unknown>;

export function useDebugValueChange(
  category: string,
  label: string,
  values: DebugValueMap,
): void {
  const previousRef = useRef<DebugValueMap | null>(null);

  // Intentionally no dependency array: this debug hook exists to compare
  // references across every render and only records when measurement is on.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isDebugMeasurementEnabled()) {
      previousRef.current = values;
      return;
    }

    const previous = previousRef.current;
    previousRef.current = values;
    const changedKeys = previous
      ? Object.keys(values).filter((key) => !Object.is(previous[key], values[key]))
      : Object.keys(values);

    if (changedKeys.length === 0) {
      return;
    }

    recordMeasurementDiagnostic({
      category,
      label,
      keys: changedKeys,
      count: changedKeys.length,
      detail: JSON.stringify({
        changedKeys,
        changedKeyCount: changedKeys.length,
        changes: summarizeValueChanges(previous, values, changedKeys),
      }),
    });
  });
}

function summarizeValueChanges(
  previous: DebugValueMap | null,
  next: DebugValueMap,
  changedKeys: readonly string[],
): Record<string, DebugValueChangeSummary> {
  const changes: Record<string, DebugValueChangeSummary> = {};
  for (const key of changedKeys.slice(0, 16)) {
    const before = previous?.[key];
    const after = next[key];
    changes[key] = {
      sameType: summarizeKind(before) === summarizeKind(after),
      sameShape: summarizeShape(before) === summarizeShape(after),
      before: summarizeValue(before),
      after: summarizeValue(after),
    };
  }
  return changes;
}

interface DebugValueChangeSummary {
  sameType: boolean;
  sameShape: boolean;
  before: DebugValueSummary;
  after: DebugValueSummary;
}

type DebugValueSummary =
  | { kind: "array"; length: number }
  | { kind: "object"; keyCount: number; keys: string[] }
  | { kind: "map"; size: number }
  | { kind: "set"; size: number }
  | { kind: "null" }
  | { kind: "primitive"; valueType: string; value: string | number | boolean | null };

function summarizeValue(value: unknown): DebugValueSummary {
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

function summarizeKind(value: unknown): string {
  return summarizeValue(value).kind;
}

function summarizeShape(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `array:${value.length}`;
  }
  if (value instanceof Map) {
    return `map:${value.size}`;
  }
  if (value instanceof Set) {
    return `set:${value.size}`;
  }
  if (typeof value === "object") {
    return `object:${Object.keys(value as Record<string, unknown>).sort().join(",")}`;
  }
  return `${typeof value}`;
}
