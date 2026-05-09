import { hashTimingScope } from "@anyharness/sdk";
import { envFlagEnabled } from "./debug-measurement-utils";

export function isMainThreadMeasurementEnabled(): boolean {
  return import.meta.env.DEV
    && envFlagEnabled(import.meta.env.VITE_PROLIFERATE_DEBUG_MAIN_THREAD, false);
}

export function isAnyHarnessTimingEnabled(): boolean {
  return import.meta.env.DEV
    && envFlagEnabled(import.meta.env.VITE_PROLIFERATE_DEBUG_ANYHARNESS_TIMING, false);
}

export function isDebugMeasurementEnabled(): boolean {
  return isMainThreadMeasurementEnabled() || isAnyHarnessTimingEnabled();
}

export function hashMeasurementScope(value: string): string {
  return hashTimingScope(value);
}
