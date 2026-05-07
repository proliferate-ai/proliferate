import type {
  PendingInteraction,
  PendingPromptEntry,
  SessionActionCapabilities,
  SessionEventEnvelope,
  SessionExecutionSummary,
  SessionLiveConfigSnapshot,
  SessionMcpBindingSummary,
  SessionStatus,
  TranscriptState,
} from "@anyharness/sdk";
import type { PendingSessionConfigChanges } from "@/lib/domain/sessions/pending-config";
import type { MeasurementOperationId } from "@/lib/infra/measurement/debug-measurement";

export type HarnessConnectionState = "connecting" | "healthy" | "failed";
export type ClientSessionId = string;
export type MaterializedSessionId = string;

export type SessionStreamConnectionState =
  | "disconnected"
  | "connecting"
  | "open"
  | "ended";

export type SessionRelationship =
  | { kind: "root" }
  | { kind: "pending" }
  | SessionChildRelationship;

export type SessionChildRelationship =
  | {
    kind: "subagent_child";
    parentSessionId: string | null;
    sessionLinkId?: string | null;
    relation?: string | null;
    workspaceId?: string | null;
  }
  | {
    kind: "cowork_child";
    parentSessionId: string | null;
    sessionLinkId?: string | null;
    relation?: string | null;
    workspaceId?: string | null;
  }
  | {
    kind: "review_child";
    parentSessionId: string | null;
    sessionLinkId?: string | null;
    relation?: string | null;
    workspaceId?: string | null;
  }
  | {
    kind: "linked_child";
    parentSessionId: string | null;
    sessionLinkId?: string | null;
    relation?: string | null;
    workspaceId?: string | null;
  };

export interface HotPaintGate {
  workspaceId: string;
  sessionId: ClientSessionId;
  nonce: number;
  operationId: MeasurementOperationId | null;
  kind: "workspace_hot_reopen" | "session_hot_switch";
}

export interface SessionDirectoryActivitySummary {
  isStreaming: boolean;
  pendingInteractions: PendingInteraction[];
  transcriptTitle: string | null;
  errorAttentionKey: string | null;
}

export interface SessionDirectoryEntry {
  sessionId: ClientSessionId;
  materializedSessionId: MaterializedSessionId | null;
  workspaceId: string | null;
  agentKind: string;
  modelId: string | null;
  modeId: string | null;
  title: string | null;
  actionCapabilities: SessionActionCapabilities;
  liveConfig: SessionLiveConfigSnapshot | null;
  executionSummary: SessionExecutionSummary | null;
  mcpBindingSummaries: SessionMcpBindingSummary[] | null;
  pendingConfigChanges: PendingSessionConfigChanges;
  status: SessionStatus | null;
  lastPromptAt: string | null;
  streamConnectionState: SessionStreamConnectionState;
  transcriptHydrated: boolean;
  sessionRelationship: SessionRelationship;
  activity: SessionDirectoryActivitySummary;
}

export interface SessionTranscriptEntry {
  sessionId: string;
  events: SessionEventEnvelope[];
  transcript: TranscriptState;
  optimisticPrompt: PendingPromptEntry | null;
}

export interface SessionRuntimeRecord extends SessionDirectoryEntry {
  events: SessionEventEnvelope[];
  transcript: TranscriptState;
  optimisticPrompt: PendingPromptEntry | null;
}

export const DEFAULT_SESSION_ACTION_CAPABILITIES: SessionActionCapabilities = {
  fork: false,
  targetedFork: false,
};

export function sessionRelationshipEqual(
  a: SessionRelationship | undefined,
  b: SessionRelationship | undefined,
): boolean {
  if (!a || !b || a.kind !== b.kind) {
    return false;
  }
  if (a.kind === "root" || a.kind === "pending") {
    return true;
  }
  return sessionChildRelationshipEqual(a, b as SessionChildRelationship);
}

export function sessionChildRelationshipEqual(
  a: SessionChildRelationship | undefined,
  b: SessionChildRelationship | undefined,
): boolean {
  return !!a
    && !!b
    && a.kind === b.kind
    && a.parentSessionId === b.parentSessionId
    && (a.sessionLinkId ?? null) === (b.sessionLinkId ?? null)
    && (a.relation ?? null) === (b.relation ?? null)
    && (a.workspaceId ?? null) === (b.workspaceId ?? null);
}
