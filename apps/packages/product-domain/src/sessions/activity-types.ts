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
