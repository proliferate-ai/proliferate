import {
  directoryEntryEqual,
  type SessionDirectoryEntry,
} from "@/lib/domain/sessions/directory/directory-entry";
import {
  removeMaterializedIndexEntry,
  removeSessionFromWorkspaceIndex,
  updateMaterializedIndex,
  updateWorkspaceIndex,
} from "@/lib/domain/sessions/directory/directory-indexes";
import {
  sessionChildRelationshipEqual,
  sessionRelationshipEqual,
  type SessionChildRelationship,
  type SessionRelationship,
} from "@/lib/domain/sessions/directory/relationship";

export interface SessionDirectoryReducerState {
  entriesById: Record<string, SessionDirectoryEntry>;
  clientSessionIdByMaterializedSessionId: Record<string, string>;
  sessionIdsByWorkspaceId: Record<string, readonly string[]>;
  relationshipHintsBySessionId: Record<string, SessionChildRelationship>;
}

export function applyPendingRelationshipHint(
  entry: SessionDirectoryEntry,
  hint: SessionChildRelationship | undefined,
): SessionDirectoryEntry {
  return hint && entry.sessionRelationship.kind === "pending"
    ? { ...entry, sessionRelationship: hint }
    : entry;
}

export function putDirectoryEntry<TState extends SessionDirectoryReducerState>(
  state: TState,
  entry: SessionDirectoryEntry,
): TState | SessionDirectoryReducerState {
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

export function removeDirectoryEntry<TState extends SessionDirectoryReducerState>(
  state: TState,
  sessionId: string,
): TState | SessionDirectoryReducerState {
  const entry = state.entriesById[sessionId];
  if (!entry) {
    return state;
  }
  const { [sessionId]: _removed, ...entriesById } = state.entriesById;
  const clientSessionIdByMaterializedSessionId = removeMaterializedIndexEntry(
    state.clientSessionIdByMaterializedSessionId,
    entry.materializedSessionId,
  );
  const { [sessionId]: _removedHint, ...relationshipHintsBySessionId } =
    state.relationshipHintsBySessionId;
  return {
    entriesById,
    clientSessionIdByMaterializedSessionId,
    relationshipHintsBySessionId,
    sessionIdsByWorkspaceId: removeSessionFromWorkspaceIndex(
      state.sessionIdsByWorkspaceId,
      entry.workspaceId,
      sessionId,
    ),
  };
}

export function removeWorkspaceDirectoryEntries<TState extends SessionDirectoryReducerState>(
  state: TState,
  workspaceId: string,
): {
  state: TState | SessionDirectoryReducerState;
  removedSessionIds: string[];
} {
  const removedSessionIds = Object.values(state.entriesById)
    .filter((entry) => entry.workspaceId === workspaceId)
    .map((entry) => entry.sessionId);
  if (removedSessionIds.length === 0) {
    return { state, removedSessionIds };
  }
  const removed = new Set(removedSessionIds);
  const entriesById: Record<string, SessionDirectoryEntry> = Object.fromEntries(
    Object.entries(state.entriesById).filter(([sessionId]) => !removed.has(sessionId)),
  );
  const clientSessionIdByMaterializedSessionId: Record<string, string> = Object.fromEntries(
    Object.entries(state.clientSessionIdByMaterializedSessionId).filter(([, clientSessionId]) =>
      !removed.has(clientSessionId)
    ),
  );
  const relationshipHintsBySessionId: Record<string, SessionChildRelationship> = Object.fromEntries(
    Object.entries(state.relationshipHintsBySessionId).filter(([sessionId, hint]) =>
      !removed.has(sessionId) && hint.workspaceId !== workspaceId
    ),
  );
  const { [workspaceId]: _removedWorkspace, ...sessionIdsByWorkspaceId } =
    state.sessionIdsByWorkspaceId;
  return {
    state: {
      entriesById,
      clientSessionIdByMaterializedSessionId,
      relationshipHintsBySessionId,
      sessionIdsByWorkspaceId,
    },
    removedSessionIds,
  };
}

export function recordDirectoryRelationshipHint<TState extends SessionDirectoryReducerState>(
  state: TState,
  sessionId: string,
  relationship: SessionChildRelationship,
): TState | SessionDirectoryReducerState {
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
      ...putDirectoryEntry(state, {
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
    ...state,
    relationshipHintsBySessionId: {
      ...state.relationshipHintsBySessionId,
      [sessionId]: relationship,
    },
  };
}

export function setDirectoryEntryRelationship<TState extends SessionDirectoryReducerState>(
  state: TState,
  sessionId: string,
  relationship: SessionRelationship,
): TState | SessionDirectoryReducerState {
  const entry = state.entriesById[sessionId];
  if (!entry || sessionRelationshipEqual(entry.sessionRelationship, relationship)) {
    return state;
  }
  return putDirectoryEntry(state, {
    ...entry,
    sessionRelationship: relationship,
  });
}

export function removeRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) {
    return record;
  }
  const { [key]: _removed, ...rest } = record;
  return rest;
}
