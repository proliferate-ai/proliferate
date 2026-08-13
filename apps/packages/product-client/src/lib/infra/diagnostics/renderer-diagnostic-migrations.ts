import {
  diagnosticField,
  recordRendererDiagnostic,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";
import type { RendererErrorClass } from "#product/lib/infra/diagnostics/renderer-diagnostic-values";

export function recordAutomationClaimPollFailure(errorName: string): void {
  recordRendererDiagnostic({
    name: "renderer.automation.claim_poll_failed",
    severity: "warn",
    kind: "transport",
    privacy: "operational",
    fields: {
      error_name: diagnosticField(errorName, "operational"),
    },
    errorClassification: "automation_claim_poll_failed",
  });
}

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

export function recordTranscriptVirtualizerBlank(input: {
  sessionId: string;
  workspaceId: string | null;
  rowCount: number;
  renderableRowCount: number;
  virtualItemCount: number;
  firstVirtualItemIndex: number | null;
  lastVirtualItemIndex: number | null;
}): void {
  recordRendererDiagnostic({
    name: "renderer.transcript.virtualizer_blank",
    severity: "error",
    kind: "message",
    privacy: "operational",
    correlation: {
      sessionId: input.sessionId,
      ...(input.workspaceId === null ? {} : { workspaceId: input.workspaceId }),
    },
    fields: {
      row_count: diagnosticField(input.rowCount, "operational"),
      renderable_row_count: diagnosticField(input.renderableRowCount, "operational"),
      virtual_item_count: diagnosticField(input.virtualItemCount, "operational"),
      first_virtual_item_index: diagnosticField(
        input.firstVirtualItemIndex ?? -1,
        "operational",
      ),
      last_virtual_item_index: diagnosticField(
        input.lastVirtualItemIndex ?? -1,
        "operational",
      ),
    },
    errorClassification: "virtualizer_blank",
  });
}

export function recordHotWorkspaceReconcileFailure(input: {
  operationId: string | null;
  workspaceId: string;
  sessionId: string;
  errorName: string;
}): void {
  recordRendererDiagnostic({
    name: "renderer.workspace.hot_reconcile_failed",
    severity: "warn",
    kind: "message",
    privacy: "operational",
    correlation: {
      ...(input.operationId === null ? {} : { operationId: input.operationId }),
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
    },
    fields: {
      error_name: diagnosticField(input.errorName, "operational"),
    },
    errorClassification: "hot_workspace_reconcile_failed",
  });
}

export function recordSessionMetadataRefreshFailure(input: {
  sessionId: string;
  operationId?: string;
  errorName: string;
  errorMessage: string;
}): void {
  recordRendererDiagnostic({
    name: "renderer.session.metadata_refresh_failed",
    severity: "warn",
    kind: "message",
    privacy: "sensitive",
    correlation: {
      sessionId: input.sessionId,
      ...(input.operationId !== undefined ? { operationId: input.operationId } : {}),
    },
    fields: {
      error_name: diagnosticField(input.errorName, "operational"),
      message: diagnosticField(input.errorMessage, "sensitive"),
    },
    errorClassification: "session_metadata_refresh_failed",
  });
}

export function recordSessionHistoryRehydrateFailure(input: {
  sessionId: string;
  operationId?: string;
  errorName: string;
  timeoutAbort: boolean;
}): void {
  recordRendererDiagnostic({
    name: "renderer.session.history_rehydrate_failed",
    severity: "warn",
    kind: "message",
    privacy: "operational",
    correlation: {
      sessionId: input.sessionId,
      ...(input.operationId !== undefined ? { operationId: input.operationId } : {}),
    },
    fields: {
      error_name: diagnosticField(input.errorName, "operational"),
      timeout_abort: diagnosticField(input.timeoutAbort, "operational"),
    },
    errorClassification: "session_history_rehydrate_failed",
  });
}
