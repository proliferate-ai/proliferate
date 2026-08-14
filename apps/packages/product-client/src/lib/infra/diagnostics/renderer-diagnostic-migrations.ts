import {
  diagnosticField,
  recordRendererDiagnostic,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";

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
