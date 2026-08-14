import {
  directoryEntryEqual,
  type SessionDirectoryEntry,
} from "#product/lib/domain/sessions/directory/directory-entry";
import {
  removeMaterializedIndexEntry,
  removeSessionFromWorkspaceIndex,
  updateMaterializedIndex,
  updateWorkspaceIndex,
} from "#product/lib/domain/sessions/directory/directory-indexes";
import {
  sessionChildRelationshipEqual,
  sessionRelationshipEqual,
  type SessionChildRelationship,
  type SessionRelationship,
} from "#product/lib/domain/sessions/directory/relationship";

export interface SessionDirectoryReducerState {
  entriesById: Record<string, SessionDirectoryEntry>;
  clientSessionIdByMaterializedSessionId: Record<string, string>;
  sessionIdsByWorkspaceId: Record<string, readonly string[]>;
  relationshipHintsBySessionId: Record<string, SessionChildRelationship>;
  promotedRootSessionIds: ReadonlySet<string>;
  promotedRootWorkspaceIdBySessionId: Readonly<Record<string, string | null>>;
}

export function applyPendingRelationshipHint(
  entry: SessionDirectoryEntry,
  hint: SessionChildRelationship | undefined,
  promotedRootSessionIds: ReadonlySet<string> = new Set(),
): SessionDirectoryEntry {
  return !promotedRootSessionIds.has(entry.sessionId)
      && !promotedRootSessionIds.has(entry.materializedSessionId ?? "")
      && hint
      && entry.sessionRelationship.kind === "pending"
    ? { ...entry, sessionRelationship: hint }
    : entry;
}

export function putDirectoryEntry<TState extends SessionDirectoryReducerState>(
  state: TState,
  entry: SessionDirectoryEntry,
): TState | SessionDirectoryReducerState {
  const previous = state.entriesById[entry.sessionId];
  const authoritativeEntry = state.promotedRootSessionIds.has(entry.sessionId)
      || state.promotedRootSessionIds.has(entry.materializedSessionId ?? "")
    ? { ...entry, sessionRelationship: { kind: "root" } as const }
    : entry;
  const entriesById = previous && directoryEntryEqual(previous, authoritativeEntry)
    ? state.entriesById
    : {
      ...state.entriesById,
      [entry.sessionId]: authoritativeEntry,
    };
  const relationshipHintsBySessionId = state.relationshipHintsBySessionId[entry.sessionId]
    ? removeRecordKey(state.relationshipHintsBySessionId, entry.sessionId)
    : state.relationshipHintsBySessionId;
  const clientSessionIdByMaterializedSessionId = updateMaterializedIndex(
    state.clientSessionIdByMaterializedSessionId,
    previous?.materializedSessionId ?? null,
    authoritativeEntry.materializedSessionId,
    authoritativeEntry.sessionId,
  );
  const sessionIdsByWorkspaceId = updateWorkspaceIndex(
    state.sessionIdsByWorkspaceId,
    previous?.workspaceId ?? null,
    authoritativeEntry.workspaceId,
    authoritativeEntry.sessionId,
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
    promotedRootSessionIds: state.promotedRootSessionIds,
    promotedRootWorkspaceIdBySessionId: state.promotedRootWorkspaceIdBySessionId,
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
    // Promotion authority survives a transient directory unmount/remount. It
    // is cleared only with the owning workspace (or the full directory).
    promotedRootSessionIds: state.promotedRootSessionIds,
    promotedRootWorkspaceIdBySessionId: state.promotedRootWorkspaceIdBySessionId,
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
  const removedMaterializedSessionIds = new Set(removedSessionIds.flatMap((sessionId) => {
    const materializedSessionId = state.entriesById[sessionId]?.materializedSessionId;
    return materializedSessionId ? [materializedSessionId] : [];
  }));
  const promotedRootSessionIds = new Set(
    [...state.promotedRootSessionIds].filter((sessionId) =>
      state.promotedRootWorkspaceIdBySessionId[sessionId] !== workspaceId
      && !removed.has(sessionId)
      && !removedMaterializedSessionIds.has(sessionId)
    ),
  );
  const promotedRootWorkspaceIdBySessionId = Object.fromEntries(
    Object.entries(state.promotedRootWorkspaceIdBySessionId).filter(
      ([sessionId, promotedWorkspaceId]) =>
        promotedWorkspaceId !== workspaceId
        && !removed.has(sessionId)
        && !removedMaterializedSessionIds.has(sessionId),
    ),
  );
  const { [workspaceId]: _removedWorkspace, ...sessionIdsByWorkspaceId } =
    state.sessionIdsByWorkspaceId;
  if (
    removedSessionIds.length === 0
    && promotedRootSessionIds.size === state.promotedRootSessionIds.size
    && Object.keys(promotedRootWorkspaceIdBySessionId).length
      === Object.keys(state.promotedRootWorkspaceIdBySessionId).length
    && !(workspaceId in state.sessionIdsByWorkspaceId)
  ) {
    return { state, removedSessionIds };
  }
  return {
    state: {
      entriesById,
      clientSessionIdByMaterializedSessionId,
      relationshipHintsBySessionId,
      promotedRootSessionIds,
      promotedRootWorkspaceIdBySessionId,
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
    if (
      state.promotedRootSessionIds.has(sessionId)
      || state.promotedRootSessionIds.has(entry.materializedSessionId ?? "")
    ) {
      const relationshipHintsBySessionId = removeRecordKey(
        state.relationshipHintsBySessionId,
        sessionId,
      );
      return relationshipHintsBySessionId === state.relationshipHintsBySessionId
        ? state
        : { ...state, relationshipHintsBySessionId };
    }
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
  if (state.promotedRootSessionIds.has(sessionId)) {
    return state;
  }
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

export function reconcileDirectoryRootRelationship<
  TState extends SessionDirectoryReducerState,
>(
  state: TState,
  sessionId: string,
): TState | SessionDirectoryReducerState {
  const entry = state.entriesById[sessionId];
  const relationshipHintsBySessionId = removeRecordKey(
    state.relationshipHintsBySessionId,
    sessionId,
  );
  if (!entry) {
    return relationshipHintsBySessionId === state.relationshipHintsBySessionId
      ? state
      : { ...state, relationshipHintsBySessionId };
  }
  const next = setDirectoryEntryRelationship(state, sessionId, { kind: "root" });
  return relationshipHintsBySessionId === next.relationshipHintsBySessionId
    ? next
    : { ...next, relationshipHintsBySessionId };
}

export function markDirectorySessionPromoted<
  TState extends SessionDirectoryReducerState,
>(
  state: TState,
  sessionIds: readonly string[],
  workspaceId: string | null = null,
): TState | SessionDirectoryReducerState {
  const promotedRootSessionIds = new Set(state.promotedRootSessionIds);
  const promotedRootWorkspaceIdBySessionId = {
    ...state.promotedRootWorkspaceIdBySessionId,
  };
  let next: TState | SessionDirectoryReducerState = state;
  for (const sessionId of sessionIds.filter(Boolean)) {
    promotedRootSessionIds.add(sessionId);
    promotedRootWorkspaceIdBySessionId[sessionId] = workspaceId;
    next = reconcileDirectoryRootRelationship(next, sessionId);
  }
  return { ...next, promotedRootSessionIds, promotedRootWorkspaceIdBySessionId };
}

export function removeRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) {
    return record;
  }
  const { [key]: _removed, ...rest } = record;
  return rest;
}
