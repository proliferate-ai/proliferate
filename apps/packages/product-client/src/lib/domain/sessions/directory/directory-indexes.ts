export function updateMaterializedIndex(
  index: Record<string, string>,
  previousMaterializedSessionId: string | null,
  nextMaterializedSessionId: string | null,
  clientSessionId: string,
): Record<string, string> {
  if (previousMaterializedSessionId === nextMaterializedSessionId) {
    if (!nextMaterializedSessionId || nextMaterializedSessionId in index) {
      return index;
    }
    return {
      ...index,
      [nextMaterializedSessionId]: clientSessionId,
    };
  }

  let next = index;
  if (previousMaterializedSessionId) {
    next = removeMaterializedIndexEntry(
      next,
      previousMaterializedSessionId,
      clientSessionId,
    );
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

export function reconcileMaterializedIndex(
  index: Record<string, string>,
  entriesById: Record<
    string,
    { sessionId: string; materializedSessionId: string | null }
  >,
): Record<string, string> {
  let next = index;
  const mutableIndex = () => {
    if (next === index) {
      next = { ...index };
    }
    return next;
  };

  for (const [materializedSessionId, clientSessionId] of Object.entries(index)) {
    if (entriesById[clientSessionId]?.materializedSessionId !== materializedSessionId) {
      delete mutableIndex()[materializedSessionId];
    }
  }
  for (const entry of Object.values(entriesById)) {
    if (entry.materializedSessionId && !(entry.materializedSessionId in next)) {
      mutableIndex()[entry.materializedSessionId] = entry.sessionId;
    }
  }
  return next;
}

export function removeMaterializedIndexEntry(
  index: Record<string, string>,
  materializedSessionId: string | null,
  expectedClientSessionId: string,
): Record<string, string> {
  if (
    !materializedSessionId
    || !(materializedSessionId in index)
    || index[materializedSessionId] !== expectedClientSessionId
  ) {
    return index;
  }
  const { [materializedSessionId]: _removed, ...rest } = index;
  return rest;
}

export function updateWorkspaceIndex(
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

export function removeSessionFromWorkspaceIndex(
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
