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

function browserFlagEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return envFlagEnabled(window.localStorage.getItem("proliferate.debugStartup") ?? undefined, false);
  } catch {
    return false;
  }
}

export function isStartupDebugLoggingEnabled(): boolean {
  return envFlagEnabled(import.meta.env.VITE_PROLIFERATE_DEBUG_STARTUP, false)
    || browserFlagEnabled();
}

export function startStartupTimer(): number {
  return performance.now();
}

export function elapsedStartupMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

export function summarizeStartupError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
    };
  }

  return {
    errorValue: String(error),
  };
}

export function logStartupDebug(
  event: string,
  fields?: Record<string, unknown>,
): void {
  if (!isStartupDebugLoggingEnabled()) {
    return;
  }

  if (fields) {
    console.info(`[startup-debug] ${event}`, fields);
    return;
  }

  console.info(`[startup-debug] ${event}`);
}
