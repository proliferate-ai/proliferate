import {
  safeRendererErrorMessage,
  safeRendererErrorName,
} from "@proliferate/product-client/internal/lib/infra/diagnostics/renderer-diagnostic-values";
import {
  diagnosticField,
  recordRendererDiagnostic,
  type RendererDiagnosticField,
} from "@proliferate/product-client/internal/lib/infra/diagnostics/renderer-diagnostics-port";

import { recordBootDiagnostic } from "@/lib/infra/measurement/boot-stall-diagnostics";

export function recordRendererStartupEvent(message: string, elapsedMs: number): void {
  recordBootDiagnostic(`renderer_startup.${message}`);
  recordRendererDiagnostic({
    name: `renderer.startup.${message}`,
    severity: "info",
    kind: "milestone",
    privacy: "operational",
    fields: {
      elapsed_ms: diagnosticField(elapsedMs, "operational"),
    },
  });
}

export function warnRendererStartupFailure(
  stage: string,
  consoleMessage: string,
  error: unknown,
): void {
  recordRendererDiagnostic({
    name: "renderer.startup.failure",
    severity: "error",
    kind: "message",
    message: "Desktop renderer startup stage failed",
    privacy: "sensitive",
    fields: startupFailureFields(stage, error),
    errorClassification: "startup_failure",
  });
  if (import.meta.env.DEV) {
    console.warn(consoleMessage, error);
  }
}

function startupFailureFields(
  stage: string,
  error: unknown,
): Record<string, RendererDiagnosticField> {
  const fields: Record<string, RendererDiagnosticField> = {
    stage: diagnosticField(stage, "operational"),
  };
  if (typeof error === "string") {
    fields.error_message = diagnosticField(error, "sensitive");
    return fields;
  }
  if (typeof error !== "object" || error === null) {
    fields.error_kind = diagnosticField(typeof error, "operational");
    return fields;
  }
  fields.error_name = diagnosticField(safeRendererErrorName(error), "operational");
  fields.error_message = diagnosticField(safeRendererErrorMessage(error), "sensitive");
  return fields;
}
