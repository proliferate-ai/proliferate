import type { MeasurementMemorySnapshot } from "./debug-measurement-types";

export function envFlagEnabled(value: string | boolean | undefined, defaultValue = false): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (!value) {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  return !["0", "false", "off", "no"].includes(normalized);
}


export function getMeasurementMemorySnapshot(): MeasurementMemorySnapshot {
  if (typeof performance === "undefined") {
    return {
      usedJSHeapSize: null,
      totalJSHeapSize: null,
      jsHeapSizeLimit: null,
    };
  }
  const memory = (performance as Performance & {
    memory?: {
      usedJSHeapSize?: number;
      totalJSHeapSize?: number;
      jsHeapSizeLimit?: number;
    };
  }).memory;
  return {
    usedJSHeapSize: memory?.usedJSHeapSize ?? null,
    totalJSHeapSize: memory?.totalJSHeapSize ?? null,
    jsHeapSizeLimit: memory?.jsHeapSizeLimit ?? null,
  };
}


export function getTimeOrigin(): number | null {
  return typeof performance !== "undefined" && typeof performance.timeOrigin === "number"
    ? performance.timeOrigin
    : null;
}


export function pushBounded<T>(items: T[], item: T, limit: number): void {
  items.push(item);
  if (items.length > limit) {
    items.splice(0, items.length - limit);
  }
}


export function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}


export function round(value: number): number {
  return Math.round(value * 100) / 100;
}
