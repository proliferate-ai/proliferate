export function updateMaterializedIndex(
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

export function removeMaterializedIndexEntry(
  index: Record<string, string>,
  materializedSessionId: string | null,
): Record<string, string> {
  if (!materializedSessionId || !(materializedSessionId in index)) {
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
