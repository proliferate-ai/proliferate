import type {
  Goal,
  PendingInteraction,
  SessionActionCapabilities,
  SessionActivity,
  SessionExecutionSummary,
  SessionLiveConfigSnapshot,
  SessionMcpBindingSummary,
  SessionStatus,
} from "@anyharness/sdk";
import type { PendingSessionConfigChanges } from "@proliferate/product-domain/sessions/pending-config";
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
  /**
   * Latest in-progress turn already ends in completed assistant prose — the
   * settling window where sidebar/session status must not read "iterating".
   */
  endsInFinalAssistantProse: boolean;
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
  requestedModelId: string | null;
  modeId: string | null;
  title: string | null;
  actionCapabilities: SessionActionCapabilities;
  liveConfig: SessionLiveConfigSnapshot | null;
  executionSummary: SessionExecutionSummary | null;
  mcpBindingSummaries: SessionMcpBindingSummary[] | null;
  pendingConfigChanges: PendingSessionConfigChanges;
  /** Mirrored native goal (latest non-cleared); null when no goal exists. */
  activeGoal: Goal | null;
  /**
   * Mirrored SessionActivity roster aggregate (loops + processes + subagents);
   * null when the session has no live activity. Seeded from `Session.activity`
   * and folded forward by the loop/process/subagent stream events.
   */
  sessionActivity: SessionActivity | null;
  status: SessionStatus | null;
  lastPromptAt: string | null;
  hasAttemptedPrompt: boolean;
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
  requestedModelId?: string | null;
  modeId?: string | null;
  title?: string | null;
  actionCapabilities?: SessionActionCapabilities | null;
  liveConfig?: SessionLiveConfigSnapshot | null;
  executionSummary?: SessionExecutionSummary | null;
  mcpBindingSummaries?: SessionMcpBindingSummary[] | null;
  pendingConfigChanges?: PendingSessionConfigChanges;
  activeGoal?: Goal | null;
  sessionActivity?: SessionActivity | null;
  status?: SessionStatus | null;
  lastPromptAt?: string | null;
  hasAttemptedPrompt?: boolean;
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
  endsInFinalAssistantProse: false,
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
    requestedModelId: input.requestedModelId ?? existing?.requestedModelId ?? null,
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
    activeGoal:
      input.activeGoal !== undefined
        ? input.activeGoal
        : existing?.activeGoal ?? null,
    sessionActivity:
      input.sessionActivity !== undefined
        ? input.sessionActivity
        : existing?.sessionActivity ?? null,
    status: input.status ?? existing?.status ?? null,
    lastPromptAt: input.lastPromptAt ?? existing?.lastPromptAt ?? null,
    hasAttemptedPrompt:
      input.hasAttemptedPrompt === true || existing?.hasAttemptedPrompt === true,
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
    && a.requestedModelId === b.requestedModelId
    && a.modeId === b.modeId
    && a.title === b.title
    && a.actionCapabilities === b.actionCapabilities
    && a.liveConfig === b.liveConfig
    && a.executionSummary === b.executionSummary
    && a.mcpBindingSummaries === b.mcpBindingSummaries
    && a.pendingConfigChanges === b.pendingConfigChanges
    && a.activeGoal === b.activeGoal
    && a.sessionActivity === b.sessionActivity
    && a.status === b.status
    && a.lastPromptAt === b.lastPromptAt
    && a.hasAttemptedPrompt === b.hasAttemptedPrompt
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
    && a.endsInFinalAssistantProse === b.endsInFinalAssistantProse
    && a.pendingInteractions === b.pendingInteractions
    && a.transcriptTitle === b.transcriptTitle
    && a.errorAttentionKey === b.errorAttentionKey;
}
