import type {
  PendingInteraction,
  SessionActionCapabilities,
  SessionExecutionSummary,
  SessionLiveConfigSnapshot,
  SessionMcpBindingSummary,
  SessionStatus,
} from "@anyharness/sdk";
import type { PendingSessionConfigChanges } from "@/lib/domain/sessions/pending-config";
import {
  sessionRelationshipEqual,
  type SessionChildRelationship,
  type SessionRelationship,
} from "@/lib/domain/sessions/directory/relationship";

export type ClientSessionId = string;
export type MaterializedSessionId = string;

export type SessionStreamConnectionState =
  | "disconnected"
  | "connecting"
  | "open"
  | "ended";

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

export interface DirectoryEntryInput {
  sessionId: string;
  materializedSessionId?: string | null;
  workspaceId?: string | null;
  agentKind: string;
  modelId?: string | null;
  modeId?: string | null;
  title?: string | null;
  actionCapabilities?: SessionActionCapabilities | null;
  liveConfig?: SessionLiveConfigSnapshot | null;
  executionSummary?: SessionExecutionSummary | null;
  mcpBindingSummaries?: SessionMcpBindingSummary[] | null;
  pendingConfigChanges?: PendingSessionConfigChanges;
  status?: SessionStatus | null;
  lastPromptAt?: string | null;
  streamConnectionState?: SessionStreamConnectionState;
  transcriptHydrated?: boolean;
  sessionRelationship?: SessionRelationship;
  activity?: Partial<SessionDirectoryActivitySummary>;
}

export type DirectoryEntryPatch =
  Partial<Omit<SessionDirectoryEntry, "activity" | "sessionId">>
  & { activity?: Partial<SessionDirectoryActivitySummary> };

export const DEFAULT_SESSION_ACTION_CAPABILITIES: SessionActionCapabilities = {
  fork: false,
  targetedFork: false,
};

export const EMPTY_DIRECTORY_ACTIVITY: SessionDirectoryActivitySummary = {
  isStreaming: false,
  pendingInteractions: [],
  transcriptTitle: null,
  errorAttentionKey: null,
};

export function createDirectoryEntry(input: DirectoryEntryInput): SessionDirectoryEntry {
  return normalizeDirectoryEntryInput(input, undefined, undefined);
}

export function normalizeDirectoryEntryInput(
  input: DirectoryEntryInput,
  existing?: SessionDirectoryEntry,
  hint?: SessionChildRelationship,
): SessionDirectoryEntry {
  return {
    sessionId: input.sessionId,
    materializedSessionId:
      input.materializedSessionId !== undefined
        ? input.materializedSessionId
        : existing?.materializedSessionId ?? input.sessionId,
    workspaceId: input.workspaceId ?? existing?.workspaceId ?? null,
    agentKind: input.agentKind,
    modelId: input.modelId ?? existing?.modelId ?? null,
    modeId: input.modeId ?? existing?.modeId ?? null,
    title: input.title ?? existing?.title ?? null,
    actionCapabilities:
      input.actionCapabilities
      ?? existing?.actionCapabilities
      ?? DEFAULT_SESSION_ACTION_CAPABILITIES,
    liveConfig: input.liveConfig ?? existing?.liveConfig ?? null,
    executionSummary: input.executionSummary ?? existing?.executionSummary ?? null,
    mcpBindingSummaries:
      input.mcpBindingSummaries
      ?? existing?.mcpBindingSummaries
      ?? null,
    pendingConfigChanges: input.pendingConfigChanges ?? existing?.pendingConfigChanges ?? {},
    status: input.status ?? existing?.status ?? null,
    lastPromptAt: input.lastPromptAt ?? existing?.lastPromptAt ?? null,
    streamConnectionState:
      input.streamConnectionState
      ?? existing?.streamConnectionState
      ?? "disconnected",
    transcriptHydrated: input.transcriptHydrated ?? existing?.transcriptHydrated ?? false,
    sessionRelationship:
      input.sessionRelationship
      ?? hint
      ?? existing?.sessionRelationship
      ?? { kind: "pending" },
    activity: {
      ...EMPTY_DIRECTORY_ACTIVITY,
      ...existing?.activity,
      ...input.activity,
    },
  };
}

export function normalizePatchedDirectoryEntry(
  entry: SessionDirectoryEntry,
  patch: DirectoryEntryPatch,
): SessionDirectoryEntry {
  return {
    ...entry,
    ...patch,
    activity: patch.activity
      ? {
        ...entry.activity,
        ...patch.activity,
      }
      : entry.activity,
  };
}

export function directoryEntryEqual(
  a: SessionDirectoryEntry,
  b: SessionDirectoryEntry,
): boolean {
  return a.sessionId === b.sessionId
    && a.materializedSessionId === b.materializedSessionId
    && a.workspaceId === b.workspaceId
    && a.agentKind === b.agentKind
    && a.modelId === b.modelId
    && a.modeId === b.modeId
    && a.title === b.title
    && a.actionCapabilities === b.actionCapabilities
    && a.liveConfig === b.liveConfig
    && a.executionSummary === b.executionSummary
    && a.mcpBindingSummaries === b.mcpBindingSummaries
    && a.pendingConfigChanges === b.pendingConfigChanges
    && a.status === b.status
    && a.lastPromptAt === b.lastPromptAt
    && a.streamConnectionState === b.streamConnectionState
    && a.transcriptHydrated === b.transcriptHydrated
    && sessionRelationshipEqual(a.sessionRelationship, b.sessionRelationship)
    && activitySummaryEqual(a.activity, b.activity);
}

export function activitySummaryEqual(
  a: SessionDirectoryActivitySummary,
  b: SessionDirectoryActivitySummary,
): boolean {
  return a.isStreaming === b.isStreaming
    && a.pendingInteractions === b.pendingInteractions
    && a.transcriptTitle === b.transcriptTitle
    && a.errorAttentionKey === b.errorAttentionKey;
}
