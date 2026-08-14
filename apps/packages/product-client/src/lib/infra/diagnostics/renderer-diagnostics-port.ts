import type { SeverityV1 } from "#product/domain/diagnostics/contract";

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
