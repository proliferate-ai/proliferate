import {
  setAnyHarnessTimingObserver,
} from "@anyharness/sdk";
import { installDebugMainThreadDetectors } from "@/lib/infra/measurement/debug-main-thread";
import { recordMeasurementMetric } from "@/lib/infra/measurement/debug-measurement";
import { installDebugMeasurementExport } from "@/lib/infra/measurement/debug-measurement-dump";
import { isAnyHarnessTimingEnabled } from "@/lib/infra/measurement/debug-measurement-env";
import { isProliferatePerfFlagEnabled } from "@/lib/infra/perf/perf-isolation-flags";
import type { MeasurementOperationId } from "./debug-measurement-catalog-types";

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

      if (isProliferatePerfFlagEnabled("suppressAnyHarnessStreamMetrics")) {
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
