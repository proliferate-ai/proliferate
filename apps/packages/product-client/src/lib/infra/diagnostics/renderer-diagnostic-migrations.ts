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

// Transcript-only diagnostic records (blank-fallback, pin-transition,
// user-scroll-intent) live in ./renderer-diagnostic-migrations-transcript
// instead of here. That file is only reachable from the chat/transcript UI
// hooks (mounted after auth, inside the AuthenticatedProductClient lazy
// chunk); this file's exports are also reached from `use-turn-end-diagnostics`,
// which `ProductLifecycleRoot` mounts unconditionally, so anything added here
// travels into the /login bundle. See renderer-diagnostic-migrations-transcript.ts
// for the split rationale (PRO-187, login runtime-budget fix).

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
