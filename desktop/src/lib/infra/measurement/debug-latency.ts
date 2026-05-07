function envFlagEnabled(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }

  return !["0", "false", "off", "no"].includes(normalized);
}

export function isLatencyDebugLoggingEnabled(): boolean {
  return import.meta.env.DEV
    && envFlagEnabled(import.meta.env.VITE_PROLIFERATE_DEBUG_LATENCY, false);
}

export function startLatencyTimer(): number {
  return performance.now();
}

export function elapsedMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

export function elapsedSince(createdAt: number): number {
  return Math.max(0, Date.now() - createdAt);
}

export function logLatency(
  event: string,
  fields?: Record<string, unknown>,
): void {
  if (!isLatencyDebugLoggingEnabled()) {
    return;
  }

  if (fields) {
    console.info(`[workspace-latency] ${event}`, fields);
    return;
  }

  console.info(`[workspace-latency] ${event}`);
}
