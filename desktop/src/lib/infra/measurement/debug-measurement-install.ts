import {
  setAnyHarnessTimingObserver,
} from "@anyharness/sdk";
import { installDebugMainThreadDetectors } from "@/lib/infra/measurement/debug-main-thread";
import {
  installDebugMeasurementExport,
  isAnyHarnessTimingEnabled,
  recordMeasurementMetric,
  type MeasurementOperationId,
} from "@/lib/infra/measurement/debug-measurement";

let uninstallMeasurement: (() => void) | null = null;

export function installDebugMeasurement(): () => void {
  if (uninstallMeasurement) {
    return uninstallMeasurement;
  }

  const uninstallMainThread = installDebugMainThreadDetectors();
  const uninstallExport = installDebugMeasurementExport();
  const uninstallAnyHarness = isAnyHarnessTimingEnabled()
    ? setAnyHarnessTimingObserver((event) => {
      if (event.type === "request") {
        recordMeasurementMetric({
          type: "request",
          transport: "anyharness",
          category: event.category,
          operationId: event.measurementOperationId as MeasurementOperationId | undefined,
          runtimeUrlHash: event.runtimeUrlHash,
          method: event.method,
          status: event.status,
          durationMs: event.durationMs,
        });
        return;
      }

      recordMeasurementMetric({
        type: "stream",
        category: event.category,
        operationId: event.measurementOperationId as MeasurementOperationId | undefined,
        runtimeUrlHash: event.runtimeUrlHash,
        phase: event.phase,
        durationMs: event.durationMs,
        eventCount: event.eventCount,
        maxInterArrivalGapMs: event.maxInterArrivalGapMs,
        malformedEventCount: event.malformedEventCount,
      });
    })
    : () => undefined;

  uninstallMeasurement = () => {
    uninstallAnyHarness();
    uninstallExport();
    uninstallMainThread();
    uninstallMeasurement = null;
  };
  return uninstallMeasurement;
}
