import { isLatencyDebugLoggingEnabled } from "@/lib/infra/measurement/debug-latency";
import {
  diagnosticField,
  recordRendererDiagnostic,
} from "@proliferate/product-client/internal/lib/infra/diagnostics/renderer-diagnostics-port";

function browserFlagEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const value = window.localStorage.getItem("proliferate.debugSessionActivity");
    if (!value) {
      return false;
    }
    return !["0", "false", "off", "no"].includes(value.trim().toLowerCase());
  } catch {
    return false;
  }
}

export function isSessionActivityDebugLoggingEnabled(): boolean {
  return isLatencyDebugLoggingEnabled() || browserFlagEnabled();
}

/** The full input set of the busy/view-state rules, captured per transition
 * so a stuck "working" names the input that held it (executionSummary.phase
 * vs transcript streaming vs status vs pending interactions). */
export interface SessionActivityDebugSnapshot {
  viewState: string;
  executionPhase: string | null;
  status: string | null;
  transcriptIsStreaming: boolean;
  streamConnectionState: string | null;
  pendingInteractionCount: number;
  executionSummaryUpdatedAt: string | null;
}

const lastBySessionId = new Map<string, SessionActivityDebugSnapshot>();

export function logSessionActivityTransition(
  sessionId: string,
  next: SessionActivityDebugSnapshot,
): void {
  if (!isSessionActivityDebugLoggingEnabled()) {
    return;
  }

  const previous = lastBySessionId.get(sessionId);
  if (previous && snapshotsEqual(previous, next)) {
    return;
  }
  lastBySessionId.set(sessionId, next);

  recordRendererDiagnostic({
    name: "renderer.measurement.session_activity",
    severity: "debug",
    kind: "progress",
    privacy: "sensitive",
    correlation: { sessionId },
    fields: {
      previous_view_state: diagnosticField(previous?.viewState ?? "none", "operational"),
      view_state: diagnosticField(next.viewState, "operational"),
      execution_phase: diagnosticField(next.executionPhase ?? "none", "operational"),
      status: diagnosticField(next.status ?? "none", "operational"),
      transcript_is_streaming: diagnosticField(next.transcriptIsStreaming, "operational"),
      stream_connection_state: diagnosticField(
        next.streamConnectionState ?? "none",
        "operational",
      ),
      pending_interaction_count: diagnosticField(
        next.pendingInteractionCount,
        "operational",
      ),
      execution_summary_updated_at: diagnosticField(
        next.executionSummaryUpdatedAt ?? "none",
        "sensitive",
      ),
    },
  });

  console.info(`[session-activity] ${sessionId} ${previous?.viewState ?? "∅"} -> ${next.viewState}`, {
    sessionId,
    from: previous ?? null,
    ...next,
  });
}

export function forgetSessionActivityDebugState(sessionId: string): void {
  lastBySessionId.delete(sessionId);
}

function snapshotsEqual(
  a: SessionActivityDebugSnapshot,
  b: SessionActivityDebugSnapshot,
): boolean {
  return a.viewState === b.viewState
    && a.executionPhase === b.executionPhase
    && a.status === b.status
    && a.transcriptIsStreaming === b.transcriptIsStreaming
    && a.streamConnectionState === b.streamConnectionState
    && a.pendingInteractionCount === b.pendingInteractionCount;
}
