import type { SeverityV1 } from "#product/domain/diagnostics/contract";
import {
  setLoadingDiagnosticsSink,
  type LoadingDiagnosticEvent,
} from "#product/primitives/utils/loading-diagnostics";

export type RendererDiagnosticPrivacy =
  | "operational"
  | "customer_content"
  | "sensitive";

export type RendererDiagnosticKind =
  | "log"
  | "message"
  | "milestone"
  | "progress"
  | "transport";

export interface RendererDiagnosticField {
  privacy: RendererDiagnosticPrivacy;
  value: unknown;
}

export interface RendererDiagnosticCorrelation {
  operationId?: string;
  parentOperationId?: string;
  traceId?: string;
  workspaceId?: string;
  sessionId?: string;
  turnId?: string;
  itemId?: string;
  requestId?: string;
  targetId?: string;
  promptId?: string;
  workflowId?: string;
}

export interface RendererDiagnosticInput {
  name: string;
  severity: SeverityV1;
  kind?: RendererDiagnosticKind;
  message?: string;
  privacy: RendererDiagnosticPrivacy;
  fields?: Readonly<Record<string, RendererDiagnosticField>>;
  correlation?: RendererDiagnosticCorrelation;
  errorClassification?: string;
}

export interface RendererDiagnosticsSink {
  emit(input: RendererDiagnosticInput): void;
}

const noopRendererDiagnosticsSink: RendererDiagnosticsSink = {
  emit: () => undefined,
};

const PORT_STATE_KEY = Symbol.for("proliferate.renderer-diagnostics-port");

interface RendererDiagnosticsPortState {
  sink: RendererDiagnosticsSink;
}

function portState(): RendererDiagnosticsPortState {
  const processScope = globalThis as typeof globalThis & {
    [key: symbol]: unknown;
  };
  const existing = processScope[PORT_STATE_KEY];
  if (existing !== undefined) {
    return existing as RendererDiagnosticsPortState;
  }
  const created = { sink: noopRendererDiagnosticsSink };
  processScope[PORT_STATE_KEY] = created;
  return created;
}

export function diagnosticField(
  value: unknown,
  privacy: RendererDiagnosticPrivacy,
): RendererDiagnosticField {
  return { privacy, value };
}

export function recordRendererDiagnostic(input: RendererDiagnosticInput): void {
  try {
    portState().sink.emit(input);
  } catch {
    // Detailed diagnostics must never change the caller's product behavior.
  }
}

export function setRendererDiagnosticsSink(
  next: RendererDiagnosticsSink,
): void {
  portState().sink = next;
}

export function resetRendererDiagnosticsSinkForTest(): void {
  portState().sink = noopRendererDiagnosticsSink;
}

/**
 * Map a lower-layer `LoadingBoundary` event into the identical
 * `RendererDiagnosticInput` shape it used to build directly, before the
 * primitives -> lib edge was inverted. Only the fields present on the event are
 * emitted, matching the original per-mark field sets exactly.
 */
function loadingDiagnosticFields(
  event: LoadingDiagnosticEvent,
): Record<string, RendererDiagnosticField> {
  const fields: Record<string, RendererDiagnosticField> = {
    flow: diagnosticField(event.flow, "operational"),
  };
  if (event.resolution !== undefined) {
    fields.resolution = diagnosticField(event.resolution, "operational");
  }
  if (event.heldMs !== undefined) {
    fields.held_ms = diagnosticField(event.heldMs, "operational");
  }
  if (event.elapsedMs !== undefined) {
    fields.elapsed_ms = diagnosticField(event.elapsedMs, "operational");
  }
  if (event.showDelayMs !== undefined) {
    fields.show_delay_ms = diagnosticField(event.showDelayMs, "operational");
  }
  if (event.minDisplayMs !== undefined) {
    fields.min_display_ms = diagnosticField(event.minDisplayMs, "operational");
  }
  return fields;
}

// Wire the primitives-layer loading seam into this port. `LoadingBoundary` may
// not import lib (upward edge), so it emits through its own sink and this
// module — legally importing downward into primitives — registers the
// forwarder. Loading the port (as every renderer diagnostics consumer does)
// activates it.
setLoadingDiagnosticsSink({
  record(event) {
    recordRendererDiagnostic({
      name: event.name,
      severity: "debug",
      kind: "progress",
      privacy: "operational",
      correlation: event.correlation,
      fields: loadingDiagnosticFields(event),
    });
  },
});
