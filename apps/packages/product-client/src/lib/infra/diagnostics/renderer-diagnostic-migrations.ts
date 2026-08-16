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

// Rung 11 (PRO-187, requirement R10 / design question Q8): Cell 10's jank note
// was that pin-state transitions and classification outcomes were sampled for
// perf only, never persisted as debuggable events, so a production scroll bug
// could only be reproduced by hand. These two records are the fix: together
// they let a scripted bug reproduce from logs alone (rung 11's gate) —
// `renderer.transcript.user_scroll_intent` is the input-intent signal, and
// `renderer.transcript.pin_transition` is the resulting (or missing) pin-state
// change, each carrying the cause the engine already attributes internally.
// Observation-only: recording a transition never influences it, and both
// records reuse the SAME choke points (`setPinned`, `notifyUserScrollIntent`)
// the engine already uses for its own bookkeeping, so there is no new scroll
// writer and negligible overhead beyond the existing call.
export type TranscriptPinTransitionCause =
  | "user_intent_unpin"
  | "leave_band"
  | "repin_band"
  | "submit_repin"
  | "button_click"
  | "session_reset"
  | "restore_stranded"
  | "unspecified";

export function recordTranscriptPinTransition(input: {
  sessionId: string;
  pinned: boolean;
  cause: TranscriptPinTransitionCause;
}): void {
  recordRendererDiagnostic({
    name: "renderer.transcript.pin_transition",
    severity: "debug",
    kind: "message",
    privacy: "operational",
    correlation: { sessionId: input.sessionId },
    fields: {
      pinned: diagnosticField(input.pinned, "operational"),
      cause: diagnosticField(input.cause, "operational"),
    },
  });
}

export function recordTranscriptUserScrollIntent(input: {
  sessionId: string;
  direction: -1 | 1;
}): void {
  recordRendererDiagnostic({
    name: "renderer.transcript.user_scroll_intent",
    severity: "debug",
    kind: "message",
    privacy: "operational",
    correlation: { sessionId: input.sessionId },
    fields: {
      direction: diagnosticField(input.direction, "operational"),
    },
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
