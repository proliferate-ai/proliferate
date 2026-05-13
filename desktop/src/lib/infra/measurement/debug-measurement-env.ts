import { hashTimingScope } from "@anyharness/sdk";
import { isProliferatePerfFlagEnabled } from "@/lib/infra/perf/perf-isolation-flags";
import { envFlagEnabled } from "./debug-measurement-utils";

export function isMainThreadMeasurementEnabled(): boolean {
  if (isProliferatePerfFlagEnabled("disableDebugMeasurement")) {
    return false;
  }
  return import.meta.env.DEV
    && envFlagEnabled(import.meta.env.VITE_PROLIFERATE_DEBUG_MAIN_THREAD, false);
}

export function isAnyHarnessTimingEnabled(): boolean {
  if (isProliferatePerfFlagEnabled("disableDebugMeasurement")) {
    return false;
  }
  return import.meta.env.DEV
    && envFlagEnabled(import.meta.env.VITE_PROLIFERATE_DEBUG_ANYHARNESS_TIMING, false);
}

export function isDebugMeasurementEnabled(): boolean {
  if (isProliferatePerfFlagEnabled("disableDebugMeasurement")) {
    return false;
  }
  return isMainThreadMeasurementEnabled() || isAnyHarnessTimingEnabled();
}

export function hashMeasurementScope(value: string): string {
  return hashTimingScope(value);
}
