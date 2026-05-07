import { useEffect, useRef } from "react";
import {
  isDebugMeasurementEnabled,
  recordMeasurementDiagnostic,
} from "@/lib/infra/measurement/debug-measurement";

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
    });
  });
}
