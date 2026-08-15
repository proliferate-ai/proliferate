import {
  diagnosticField,
  recordRendererDiagnostic,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";
import type { RendererErrorClass } from "#product/lib/infra/diagnostics/renderer-diagnostic-values";

/**
 * Connection and stream lifecycle: the session SSE stream, the runtime
 * bootstrap handshake, and the terminal/feed websockets. Split out of
 * renderer-diagnostic-migrations.ts, which tripled in size when these
 * landed and was heading for junk-drawer status.
 */

export type SessionStreamCloseReason =
  | "ended"
  | "reconnect_scheduled"
  | "suppressed"
  | "stale_handle";

export function recordSessionStreamOpened(input: {
  sessionId: string;
  attempt: number;
}): void {
  recordRendererDiagnostic({
    name: "renderer.session_stream.opened",
    severity: "info",
    kind: "transport",
    privacy: "operational",
    correlation: { sessionId: input.sessionId },
    fields: {
      attempt: diagnosticField(input.attempt, "operational"),
    },
  });
}

export function recordSessionStreamClosed(input: {
  sessionId: string;
  attempt: number;
  closeReason: SessionStreamCloseReason;
}): void {
  recordRendererDiagnostic({
    name: "renderer.session_stream.closed",
    severity: "info",
    kind: "transport",
    privacy: "operational",
    correlation: { sessionId: input.sessionId },
    fields: {
      attempt: diagnosticField(input.attempt, "operational"),
      close_reason: diagnosticField(input.closeReason, "operational"),
    },
  });
}

export function recordSessionStreamError(input: {
  sessionId: string;
  attempt: number;
  errorClass: RendererErrorClass;
}): void {
  recordRendererDiagnostic({
    name: "renderer.session_stream.error",
    severity: "warn",
    kind: "transport",
    privacy: "operational",
    correlation: { sessionId: input.sessionId },
    fields: {
      attempt: diagnosticField(input.attempt, "operational"),
      error_class: diagnosticField(input.errorClass, "operational"),
    },
    errorClassification: "session_stream_error",
  });
}

export function recordSessionStreamReconnectScheduled(input: {
  sessionId: string;
  attempt: number;
  delayMs: number;
}): void {
  recordRendererDiagnostic({
    name: "renderer.session_stream.reconnect_scheduled",
    severity: "info",
    kind: "transport",
    privacy: "operational",
    correlation: { sessionId: input.sessionId },
    fields: {
      attempt: diagnosticField(input.attempt, "operational"),
      delay_ms: diagnosticField(input.delayMs, "operational"),
    },
  });
}

export type RuntimeConnectionState = "connecting" | "healthy" | "failed";

export function recordRuntimeConnectionState(input: {
  state: RuntimeConnectionState;
  elapsedMs: number;
}): void {
  recordRendererDiagnostic({
    name: "renderer.connection.runtime_state",
    severity: input.state === "failed" ? "warn" : "info",
    kind: "transport",
    privacy: "operational",
    fields: {
      state: diagnosticField(input.state, "operational"),
      elapsed_ms: diagnosticField(input.elapsedMs, "operational"),
    },
    ...(input.state === "failed"
      ? { errorClassification: "runtime_connection_failed" }
      : {}),
  });
}

export type RendererStreamKind = "terminal" | "feed";

interface TerminalStreamRecordInput {
  kind: RendererStreamKind;
  workspaceId: string | null;
  targetId: string;
}

function terminalStreamCorrelation(input: TerminalStreamRecordInput) {
  return {
    ...(input.workspaceId === null ? {} : { workspaceId: input.workspaceId }),
    targetId: input.targetId,
  };
}

export function recordTerminalStreamOpened(input: TerminalStreamRecordInput): void {
  recordRendererDiagnostic({
    name: "renderer.terminal_stream.opened",
    severity: "debug",
    kind: "transport",
    privacy: "operational",
    correlation: terminalStreamCorrelation(input),
    fields: {
      kind: diagnosticField(input.kind, "operational"),
    },
  });
}

export function recordTerminalStreamClosed(input: TerminalStreamRecordInput): void {
  recordRendererDiagnostic({
    name: "renderer.terminal_stream.closed",
    severity: "debug",
    kind: "transport",
    privacy: "operational",
    correlation: terminalStreamCorrelation(input),
    fields: {
      kind: diagnosticField(input.kind, "operational"),
    },
  });
}

export function recordTerminalStreamError(input: TerminalStreamRecordInput): void {
  recordRendererDiagnostic({
    name: "renderer.terminal_stream.error",
    severity: "warn",
    kind: "transport",
    privacy: "operational",
    correlation: terminalStreamCorrelation(input),
    fields: {
      kind: diagnosticField(input.kind, "operational"),
    },
    errorClassification: "terminal_stream_error",
  });
}
