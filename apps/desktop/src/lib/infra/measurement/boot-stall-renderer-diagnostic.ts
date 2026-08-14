// Mirrors boot milestones onto the renderer diagnostics port. Boot metadata is
// caller-supplied, so it is classified sensitive whenever any of it survives
// sanitization; the elapsed time is always safe to report as operational.

import {
  diagnosticField,
  recordRendererDiagnostic,
} from "@proliferate/product-client/internal/lib/infra/diagnostics/renderer-diagnostics-port";
import {
  rendererDiagnosticCorrelation,
  rendererDiagnosticFields,
  rendererDiagnosticName,
} from "@/lib/infra/diagnostics/renderer-diagnostic-callsite";
import { isNoisyBootLabel } from "./boot-stall-diagnostics-format";

export function recordBootRendererDiagnostic(
  label: string,
  elapsedMs: number,
  metadata?: Record<string, unknown>,
): void {
  if (isNoisyBootLabel(label)) {
    return;
  }
  const name = rendererDiagnosticName("renderer.boot", label);
  if (name === null) {
    return;
  }
  const metadataFields = rendererDiagnosticFields(metadata, "sensitive");
  const fields = metadataFields ?? {};
  fields.elapsed_ms = diagnosticField(elapsedMs, "operational");
  recordRendererDiagnostic({
    name,
    severity: "info",
    kind: "milestone",
    privacy: metadataFields === undefined ? "operational" : "sensitive",
    fields,
    correlation: rendererDiagnosticCorrelation(metadata),
  });
}
