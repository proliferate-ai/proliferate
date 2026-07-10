import type {
  SessionExecutionSummary,
  SessionStatus,
} from "@anyharness/sdk";

export type StreamConnectionState = "disconnected" | "connecting" | "open" | "ended";

export type SessionViewState =
  | "working"
  | "needs_input"
  | "idle"
  | "errored"
  | "closed";

export type SidebarSessionActivityState =
  | "iterating"
  | "waiting_input"
  | "waiting_plan"
  | "error"
  | "closed"
  | "idle";

export interface SessionActivitySnapshot {
  status: SessionStatus | null;
  executionSummary?: SessionExecutionSummary | null;
  streamConnectionState?: StreamConnectionState;
  /**
   * False when the session has never been prompted and no prompt is in
   * flight; undefined preserves legacy behavior.
   */
  hasPromptActivity?: boolean;
  transcript: {
    isStreaming: boolean;
    pendingInteractions: PendingInteractionLike[];
    /**
     * True when the latest in-progress turn already ends in completed
     * assistant prose (see transcriptEndsInFinalAssistantProse). Status
     * derivation then presents the session as idle during the settling
     * window between the final rendered answer and the backend phase flip,
     * instead of a dead-looking "iterating". Undefined preserves legacy
     * behavior (phase stays authoritative).
     */
    endsInFinalAssistantProse?: boolean;
  };
}

export interface PendingInteractionLike {
  requestId?: string;
  linkedPlanId?: string | null;
  source?: {
    linkedPlanId?: string | null;
  } | null;
}

export interface SessionErrorAttentionSnapshot {
  sessionId: string;
  status: SessionStatus | null;
  executionSummary?: SessionExecutionSummary | null;
  transcript: {
    itemsById: Record<string, ErrorAttentionTranscriptItem>;
  };
}

export interface ErrorAttentionTranscriptItem {
  kind: string;
  itemId: string;
  startedSeq: number;
}
