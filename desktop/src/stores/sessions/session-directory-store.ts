import { create } from "zustand";
import type {
  SessionActionCapabilities,
  SessionExecutionSummary,
  SessionLiveConfigSnapshot,
  SessionMcpBindingSummary,
  SessionStatus,
  TranscriptState,
} from "@anyharness/sdk";
import { resolveSessionErrorAttentionKey } from "@/lib/domain/sessions/activity";
import type { PendingSessionConfigChanges } from "@/lib/domain/sessions/pending-config";
import {
  DEFAULT_SESSION_ACTION_CAPABILITIES,
  sessionChildRelationshipEqual,
  sessionRelationshipEqual,
  type SessionChildRelationship,
  type SessionDirectoryActivitySummary,
  type SessionDirectoryEntry,
  type SessionRelationship,
  type SessionStreamConnectionState,
} from "@/stores/sessions/session-types";

interface DirectoryEntryInput {
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

type DirectoryEntryPatch =
  Partial<Omit<SessionDirectoryEntry, "activity" | "sessionId">>
  & { activity?: Partial<SessionDirectoryActivitySummary> };

interface SessionDirectoryState {
  entriesById: Record<string, SessionDirectoryEntry>;
  clientSessionIdByMaterializedSessionId: Record<string, string>;
  sessionIdsByWorkspaceId: Record<string, readonly string[]>;
  relationshipHintsBySessionId: Record<string, SessionChildRelationship>;
  putEntry: (entry: SessionDirectoryEntry) => void;
  upsertEntry: (input: DirectoryEntryInput) => void;
  patchEntry: (sessionId: string, patch: DirectoryEntryPatch) => void;
  patchActivityFromTranscript: (sessionId: string, transcript: TranscriptState) => void;
  removeEntry: (sessionId: string) => void;
  removeWorkspaceEntries: (workspaceId: string) => string[];
  clearEntries: () => void;
  recordRelationshipHint: (sessionId: string, relationship: SessionChildRelationship) => void;
  setSessionRelationship: (sessionId: string, relationship: SessionRelationship) => void;
}

const EMPTY_ACTIVITY: SessionDirectoryActivitySummary = {
  isStreaming: false,
  pendingInteractions: [],
  transcriptTitle: null,
  errorAttentionKey: null,
};

export const useSessionDirectoryStore = create<SessionDirectoryState>((set) => ({
  entriesById: {},
  clientSessionIdByMaterializedSessionId: {},
  sessionIdsByWorkspaceId: {},
  relationshipHintsBySessionId: {},

  putEntry: (entry) => set((state) => {
    const hint = state.relationshipHintsBySessionId[entry.sessionId];
    const nextEntry = hint && entry.sessionRelationship.kind === "pending"
      ? { ...entry, sessionRelationship: hint }
      : entry;
    return applyPutEntry(state, nextEntry);
  }),

  upsertEntry: (input) => set((state) => {
    const existing = state.entriesById[input.sessionId];
    const hint = state.relationshipHintsBySessionId[input.sessionId];
    const entry = normalizeEntryInput(input, existing, hint);
    return applyPutEntry(state, entry);
  }),

  patchEntry: (sessionId, patch) => set((state) => {
    const entry = state.entriesById[sessionId];
    if (!entry) {
      return state;
    }
    const nextEntry = normalizePatchedEntry(entry, patch);
    if (directoryEntryEqual(entry, nextEntry)) {
      return state;
    }
    return applyPutEntry(state, nextEntry);
  }),

  patchActivityFromTranscript: (sessionId, transcript) => set((state) => {
    const entry = state.entriesById[sessionId];
    if (!entry) {
      return state;
    }
    const activity = activityFromTranscript(transcript, {
      status: entry.status,
      executionSummary: entry.executionSummary,
    });
    if (activitySummaryEqual(entry.activity, activity)) {
      return state;
    }
    return applyPutEntry(state, {
      ...entry,
      modeId: transcript.currentModeId ?? entry.modeId,
      title: entry.title ?? transcript.sessionMeta.title ?? null,
      activity,
    });
  }),

  removeEntry: (sessionId) => set((state) => {
    if (!state.entriesById[sessionId]) {
      return state;
    }
    const { [sessionId]: _removed, ...entriesById } = state.entriesById;
    const clientSessionIdByMaterializedSessionId = removeMaterializedIndexEntry(
      state.clientSessionIdByMaterializedSessionId,
      state.entriesById[sessionId].materializedSessionId,
    );
    const { [sessionId]: _removedHint, ...relationshipHintsBySessionId } =
      state.relationshipHintsBySessionId;
    return {
      entriesById,
      clientSessionIdByMaterializedSessionId,
      relationshipHintsBySessionId,
      sessionIdsByWorkspaceId: removeSessionFromWorkspaceIndex(
        state.sessionIdsByWorkspaceId,
        state.entriesById[sessionId].workspaceId,
        sessionId,
      ),
    };
  }),

  removeWorkspaceEntries: (workspaceId) => {
    let removedSessionIds: string[] = [];
    set((state) => {
      removedSessionIds = Object.values(state.entriesById)
        .filter((entry) => entry.workspaceId === workspaceId)
        .map((entry) => entry.sessionId);
      if (removedSessionIds.length === 0) {
        return state;
      }
      const removed = new Set(removedSessionIds);
      const entriesById = Object.fromEntries(
        Object.entries(state.entriesById).filter(([sessionId]) => !removed.has(sessionId)),
      );
      const clientSessionIdByMaterializedSessionId = Object.fromEntries(
        Object.entries(state.clientSessionIdByMaterializedSessionId).filter(([, clientSessionId]) =>
          !removed.has(clientSessionId)
        ),
      );
      const relationshipHintsBySessionId = Object.fromEntries(
        Object.entries(state.relationshipHintsBySessionId).filter(([sessionId, hint]) =>
          !removed.has(sessionId) && hint.workspaceId !== workspaceId
        ),
      );
      const { [workspaceId]: _removedWorkspace, ...sessionIdsByWorkspaceId } =
        state.sessionIdsByWorkspaceId;
      return {
        entriesById,
        clientSessionIdByMaterializedSessionId,
        relationshipHintsBySessionId,
        sessionIdsByWorkspaceId,
      };
    });
    return removedSessionIds;
  },

  clearEntries: () => set({
    entriesById: {},
    clientSessionIdByMaterializedSessionId: {},
    sessionIdsByWorkspaceId: {},
    relationshipHintsBySessionId: {},
  }),

  recordRelationshipHint: (sessionId, relationship) => set((state) => {
    const entry = state.entriesById[sessionId];
    if (entry) {
      const relationshipHintsBySessionId = removeRecordKey(
        state.relationshipHintsBySessionId,
        sessionId,
      );
      if (sessionRelationshipEqual(entry.sessionRelationship, relationship)) {
        return relationshipHintsBySessionId === state.relationshipHintsBySessionId
          ? state
          : { ...state, relationshipHintsBySessionId };
      }
      return {
        ...applyPutEntry(state, {
          ...entry,
          sessionRelationship: relationship,
        }),
        relationshipHintsBySessionId,
      };
    }

    const existing = state.relationshipHintsBySessionId[sessionId];
    if (sessionChildRelationshipEqual(existing, relationship)) {
      return state;
    }
    return {
      relationshipHintsBySessionId: {
        ...state.relationshipHintsBySessionId,
        [sessionId]: relationship,
      },
    };
  }),

  setSessionRelationship: (sessionId, relationship) => set((state) => {
    const entry = state.entriesById[sessionId];
    if (!entry || sessionRelationshipEqual(entry.sessionRelationship, relationship)) {
      return state;
    }
    return applyPutEntry(state, {
      ...entry,
      sessionRelationship: relationship,
    });
  }),
}));

export function createDirectoryEntry(input: DirectoryEntryInput): SessionDirectoryEntry {
  return normalizeEntryInput(input, undefined, undefined);
}

export function activityFromTranscript(
  transcript: TranscriptState,
  context?: {
    status?: SessionStatus | null;
    executionSummary?: SessionExecutionSummary | null;
  },
): SessionDirectoryActivitySummary {
  return {
    isStreaming: transcript.isStreaming,
    pendingInteractions: transcript.pendingInteractions,
    transcriptTitle: transcript.sessionMeta.title ?? null,
    errorAttentionKey: resolveSessionErrorAttentionKey({
      sessionId: transcript.sessionMeta.sessionId,
      status: context?.status ?? null,
      executionSummary: context?.executionSummary ?? null,
      transcript: {
        itemsById: transcript.itemsById,
      },
    }),
  };
}

export function activitySnapshotFromDirectoryEntry(
  entry: SessionDirectoryEntry | null | undefined,
) {
  return entry
    ? {
      status: entry.status,
      executionSummary: entry.executionSummary,
      streamConnectionState: entry.streamConnectionState,
      transcript: {
        isStreaming: entry.activity.isStreaming,
        pendingInteractions: entry.activity.pendingInteractions,
      },
    }
    : null;
}

function normalizeEntryInput(
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
      ...EMPTY_ACTIVITY,
      ...existing?.activity,
      ...input.activity,
    },
  };
}

function normalizePatchedEntry(
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

function applyPutEntry(
  state: Pick<
    SessionDirectoryState,
    | "entriesById"
    | "clientSessionIdByMaterializedSessionId"
    | "sessionIdsByWorkspaceId"
    | "relationshipHintsBySessionId"
  >,
  entry: SessionDirectoryEntry,
) {
  const previous = state.entriesById[entry.sessionId];
  const entriesById = previous && directoryEntryEqual(previous, entry)
    ? state.entriesById
    : {
      ...state.entriesById,
      [entry.sessionId]: entry,
    };
  const relationshipHintsBySessionId = state.relationshipHintsBySessionId[entry.sessionId]
    ? removeRecordKey(state.relationshipHintsBySessionId, entry.sessionId)
    : state.relationshipHintsBySessionId;
  const clientSessionIdByMaterializedSessionId = updateMaterializedIndex(
    state.clientSessionIdByMaterializedSessionId,
    previous?.materializedSessionId ?? null,
    entry.materializedSessionId,
    entry.sessionId,
  );
  const sessionIdsByWorkspaceId = updateWorkspaceIndex(
    state.sessionIdsByWorkspaceId,
    previous?.workspaceId ?? null,
    entry.workspaceId,
    entry.sessionId,
  );

  if (
    entriesById === state.entriesById
    && clientSessionIdByMaterializedSessionId === state.clientSessionIdByMaterializedSessionId
    && relationshipHintsBySessionId === state.relationshipHintsBySessionId
    && sessionIdsByWorkspaceId === state.sessionIdsByWorkspaceId
  ) {
    return state;
  }
  return {
    entriesById,
    clientSessionIdByMaterializedSessionId,
    relationshipHintsBySessionId,
    sessionIdsByWorkspaceId,
  };
}

function updateMaterializedIndex(
  index: Record<string, string>,
  previousMaterializedSessionId: string | null,
  nextMaterializedSessionId: string | null,
  clientSessionId: string,
): Record<string, string> {
  let next = index;
  if (previousMaterializedSessionId && previousMaterializedSessionId !== nextMaterializedSessionId) {
    next = removeMaterializedIndexEntry(next, previousMaterializedSessionId);
  }
  if (!nextMaterializedSessionId) {
    return next;
  }
  if (next[nextMaterializedSessionId] === clientSessionId) {
    return next;
  }
  return {
    ...next,
    [nextMaterializedSessionId]: clientSessionId,
  };
}

function removeMaterializedIndexEntry(
  index: Record<string, string>,
  materializedSessionId: string | null,
): Record<string, string> {
  if (!materializedSessionId || !(materializedSessionId in index)) {
    return index;
  }
  const { [materializedSessionId]: _removed, ...rest } = index;
  return rest;
}

function updateWorkspaceIndex(
  index: Record<string, readonly string[]>,
  previousWorkspaceId: string | null,
  nextWorkspaceId: string | null,
  sessionId: string,
): Record<string, readonly string[]> {
  if (previousWorkspaceId === nextWorkspaceId) {
    if (!nextWorkspaceId || index[nextWorkspaceId]?.includes(sessionId)) {
      return index;
    }
    return {
      ...index,
      [nextWorkspaceId]: [...(index[nextWorkspaceId] ?? []), sessionId].sort(),
    };
  }
  let next = index;
  if (previousWorkspaceId) {
    next = removeSessionFromWorkspaceIndex(next, previousWorkspaceId, sessionId);
  }
  if (nextWorkspaceId) {
    const currentIds = next[nextWorkspaceId] ?? [];
    if (!currentIds.includes(sessionId)) {
      next = {
        ...next,
        [nextWorkspaceId]: [...currentIds, sessionId].sort(),
      };
    }
  }
  return next;
}

function removeSessionFromWorkspaceIndex(
  index: Record<string, readonly string[]>,
  workspaceId: string | null,
  sessionId: string,
): Record<string, readonly string[]> {
  if (!workspaceId || !index[workspaceId]?.includes(sessionId)) {
    return index;
  }
  const nextIds = index[workspaceId].filter((id) => id !== sessionId);
  if (nextIds.length === 0) {
    const { [workspaceId]: _removed, ...rest } = index;
    return rest;
  }
  return {
    ...index,
    [workspaceId]: nextIds,
  };
}

function directoryEntryEqual(
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

function activitySummaryEqual(
  a: SessionDirectoryActivitySummary,
  b: SessionDirectoryActivitySummary,
): boolean {
  return a.isStreaming === b.isStreaming
    && a.pendingInteractions === b.pendingInteractions
    && a.transcriptTitle === b.transcriptTitle
    && a.errorAttentionKey === b.errorAttentionKey;
}

function removeRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) {
    return record;
  }
  const { [key]: _removed, ...rest } = record;
  return rest;
}
