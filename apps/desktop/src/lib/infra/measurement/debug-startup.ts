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
    return envFlagEnabled(window.localStorage.getItem("proliferate.debugStartup") ?? undefined, false)
      || envFlagEnabled(window.localStorage.getItem("proliferate.bootDiagnostics") ?? undefined, false);
  } catch {
    return false;
  }
}

export function isStartupDebugLoggingEnabled(): boolean {
  return envFlagEnabled(import.meta.env.VITE_PROLIFERATE_DEBUG_STARTUP, false)
    || envFlagEnabled(import.meta.env.VITE_PROLIFERATE_BOOT_DIAGNOSTICS, false)
    || browserFlagEnabled();
}

export function startStartupTimer(): number {
  return performance.now();
}

export function elapsedStartupMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

export function summarizeStartupError(error: unknown): Record<string, unknown> {
  if (typeof error === "string") {
    return { errorValue: error };
  }
  if (typeof error === "object" && error !== null) {
    const name = safeRendererErrorName(error);
    return {
      errorName: name === "unknown_error" ? "UnknownError" : name,
      errorMessage: safeRendererErrorMessage(error),
    };
  }
  return { errorValue: `[${typeof error}]` };
}

export function logStartupDebug(
  event: string,
  fields?: Record<string, unknown>,
): void {
  if (!isStartupDebugLoggingEnabled()) {
    return;
  }

  const name = rendererDiagnosticName("renderer.startup_debug", event);
  if (name !== null) {
    recordRendererDiagnostic({
      name,
      severity: "debug",
      kind: "log",
      privacy: fields === undefined ? "operational" : "sensitive",
      fields: rendererDiagnosticFields(fields, "sensitive"),
      correlation: rendererDiagnosticCorrelation(fields),
    });
  }

  if (fields) {
    console.info(`[startup-debug] ${event}`, fields);
    return;
  }

  console.info(`[startup-debug] ${event}`);
}
import {
  safeRendererErrorMessage,
  safeRendererErrorName,
} from "@proliferate/product-client/internal/lib/infra/diagnostics/renderer-diagnostic-values";
import { recordRendererDiagnostic } from "@proliferate/product-client/internal/lib/infra/diagnostics/renderer-diagnostics-port";
import {
  rendererDiagnosticCorrelation,
  rendererDiagnosticFields,
  rendererDiagnosticName,
} from "@/lib/infra/diagnostics/renderer-diagnostic-callsite";
