import { operationSnapshot } from "./debug-measurement-snapshots";
import {
  MEMORY_SAMPLE_INTERVAL_MS,
  categoryBindings,
  operations,
  pendingCommitMarks,
  recentMemorySamples,
  recentMetrics,
  recentOperationEvents,
  recentSummaries,
} from "./debug-measurement-state";
import {
  clearDebugMeasurementBuffer as clearDebugMeasurementEventBuffer,
  recordMemorySample,
} from "./debug-measurement-events";
import { isAnyHarnessTimingEnabled, isMainThreadMeasurementEnabled } from "./debug-measurement-env";
import { getLongTaskObserverSupportedForMeasurement } from "./debug-measurement-observer";
import { getProliferatePerfFlags } from "@/lib/infra/perf/perf-isolation-flags";
import { saveDiagnosticJsonToPath } from "@/lib/access/tauri/diagnostics";
import type {
  MeasurementDebugApi,
  MeasurementDebugDump,
  MeasurementDebugStatus,
} from "./debug-measurement-report-types";
import { getMeasurementMemorySnapshot, getTimeOrigin } from "./debug-measurement-utils";

export function clearDebugMeasurementBuffer(): void {
  clearDebugMeasurementEventBuffer();
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
    perfFlags: getProliferatePerfFlags(),
    longTaskObserverSupported: getLongTaskObserverSupportedForMeasurement(),
    memory: getMeasurementMemorySnapshot(),
    counts: getDebugMeasurementStatus().counts,
    activeOperations: [...operations.values()].map(operationSnapshot),
    recentOperationEvents: [...recentOperationEvents],
    recentMetrics: [...recentMetrics],
    recentMemorySamples: [...recentMemorySamples],
    recentSummaries: [...recentSummaries],
  };
}

export function installDebugMeasurementExport(): () => void {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return () => undefined;
  }

  const api: MeasurementDebugApi = {
    dump: getDebugMeasurementDump,
    export: exportDebugMeasurementDump,
    save: saveDebugMeasurementDump,
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

async function saveDebugMeasurementDump(outputPath: string): Promise<string | null> {
  const dump = getDebugMeasurementDump();
  const body = JSON.stringify(dump, null, 2);
  const writtenPath = await saveDiagnosticJsonToPath(outputPath, body);
  if (typeof console !== "undefined") {
    console.info("[measurement_dump] saved", writtenPath ?? "(not running in Tauri)");
  }
  return writtenPath;
}
