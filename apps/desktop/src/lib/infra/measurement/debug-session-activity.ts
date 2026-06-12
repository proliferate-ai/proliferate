import { isLatencyDebugLoggingEnabled } from "@/lib/infra/measurement/debug-latency";

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
