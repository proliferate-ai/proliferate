import {
  diagnosticField,
  recordRendererDiagnostic,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";
import type { RendererErrorClass } from "#product/lib/infra/diagnostics/renderer-diagnostic-values";

/**
 * Emitted when a claim-poll failure streak STARTS, not once per poll. The poller
 * ticks every 10s for as long as the app is open, so a per-poll record made a
 * single unreachable runtime the loudest thing in the diagnostics stream.
 */
export function recordAutomationClaimPollFailure(input: {
  errorName: string;
  consecutiveFailures: number;
}): void {
  recordRendererDiagnostic({
    name: "renderer.automation.claim_poll_failed",
    severity: "warn",
    kind: "transport",
    privacy: "operational",
    fields: {
      error_name: diagnosticField(input.errorName, "operational"),
      consecutive_failures: diagnosticField(input.consecutiveFailures, "operational"),
    },
    errorClassification: "automation_claim_poll_failed",
  });
}

/** Closes the streak opened by recordAutomationClaimPollFailure. */
export function recordAutomationClaimPollRecovered(input: {
  consecutiveFailures: number;
}): void {
  recordRendererDiagnostic({
    name: "renderer.automation.claim_poll_recovered",
    severity: "info",
    kind: "transport",
    privacy: "operational",
    fields: {
      consecutive_failures: diagnosticField(input.consecutiveFailures, "operational"),
    },
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

export function recordSessionSyncBatchApplied(input: {
  sessionId: string;
  applied: number;
  duplicates: number;
  elapsedMs: number;
}): void {
  recordRendererDiagnostic({
    name: "renderer.session_sync.batch_applied",
    severity: "debug",
    kind: "progress",
    privacy: "operational",
    correlation: { sessionId: input.sessionId },
    fields: {
      applied: diagnosticField(input.applied, "operational"),
      duplicates: diagnosticField(input.duplicates, "operational"),
      elapsed_ms: diagnosticField(input.elapsedMs, "operational"),
    },
  });
}

export function recordSessionSyncGapDetected(input: {
  sessionId: string;
  gapAfterSeq: number;
}): void {
  recordRendererDiagnostic({
    name: "renderer.session_sync.gap_detected",
    severity: "warn",
    kind: "message",
    privacy: "operational",
    correlation: { sessionId: input.sessionId },
    fields: {
      // Same value the ingest store records as its gap boundary, so this record
      // and the store's stale-freshness entry name the same seq.
      gap_after_seq: diagnosticField(input.gapAfterSeq, "operational"),
    },
    errorClassification: "session_sync_gap_detected",
  });
}

export function recordWorkspaceSyncFetchFailed(input: {
  errorClass: RendererErrorClass;
}): void {
  recordRendererDiagnostic({
    name: "renderer.workspace_sync.fetch_failed",
    severity: "warn",
    kind: "transport",
    privacy: "operational",
    fields: {
      error_class: diagnosticField(input.errorClass, "operational"),
    },
    errorClassification: "workspace_sync_fetch_failed",
  });
}

export function recordWorkspaceSyncMerged(input: {
  localCount: number;
  cloudCount: number;
  mergedCount: number;
  elapsedMs: number;
}): void {
  recordRendererDiagnostic({
    name: "renderer.workspace_sync.merged",
    severity: "debug",
    kind: "progress",
    privacy: "operational",
    fields: {
      local_count: diagnosticField(input.localCount, "operational"),
      cloud_count: diagnosticField(input.cloudCount, "operational"),
      merged_count: diagnosticField(input.mergedCount, "operational"),
      elapsed_ms: diagnosticField(input.elapsedMs, "operational"),
    },
  });
}

export function recordTurnEnded(input: {
  sessionId: string;
  eventType: "turn_ended" | "error";
}): void {
  recordRendererDiagnostic({
    name: "renderer.turn.ended",
    severity: "info",
    kind: "milestone",
    privacy: "operational",
    correlation: { sessionId: input.sessionId },
    fields: {
      event_type: diagnosticField(input.eventType, "operational"),
    },
  });
}

export function recordSessionErrorBanner(input: {
  sessionId: string;
  phase: "shown" | "acknowledged";
}): void {
  recordRendererDiagnostic({
    name: "renderer.session.error_banner",
    severity: "info",
    kind: "message",
    privacy: "operational",
    correlation: { sessionId: input.sessionId },
    fields: {
      phase: diagnosticField(input.phase, "operational"),
    },
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
