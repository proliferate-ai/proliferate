export const MAX_RECENTLY_HIDDEN_CHAT_TABS = 50;

export interface ChatVisibilityCandidate {
  sessionId: string;
  parentSessionId?: string | null;
}

export interface VisibleChatSessionResolution {
  visibleSessionIds: string[];
  prunedPersistedVisibleIds: string[];
  prunedRecentlyHiddenIds: string[];
}

export function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    next.push(id);
  }
  return next;
}

export function rememberHiddenChatSessionId(
  current: string[],
  sessionId: string,
): string[] {
  return uniqueIds([sessionId, ...current]).slice(0, MAX_RECENTLY_HIDDEN_CHAT_TABS);
}

export function clearHiddenChatSessionIds(
  current: string[],
  idsToClear: Iterable<string>,
): string[] {
  const clearSet = new Set(idsToClear);
  return current.filter((id) => !clearSet.has(id));
}

export function resolveVisibleChatSessionIds(args: {
  liveSessions: ChatVisibilityCandidate[];
  persistedVisibleIds?: string[];
  recentlyHiddenIds?: string[];
  activeSessionId?: string | null;
}): VisibleChatSessionResolution {
  const liveIds = args.liveSessions.map((session) => session.sessionId);
  const liveSet = new Set(liveIds);
  const childToParent = new Map(
    args.liveSessions
      .filter((session) => !!session.parentSessionId)
      .map((session) => [session.sessionId, session.parentSessionId!]),
  );
  const hiddenSet = new Set(args.recentlyHiddenIds ?? []);
  const topLevelIds = liveIds.filter((id) => !childToParent.has(id));
  const prunedPersistedVisibleIds = uniqueIds(args.persistedVisibleIds ?? [])
    .filter((id) => liveSet.has(id));
  const prunedRecentlyHiddenIds = uniqueIds(args.recentlyHiddenIds ?? [])
    .filter((id) => liveSet.has(id));

  const hasPersistedVisible = !!args.persistedVisibleIds;
  const baseVisible = hasPersistedVisible
    ? [...prunedPersistedVisibleIds]
    : [...topLevelIds];
  const baseSet = new Set(baseVisible);

  if (hasPersistedVisible) {
    for (const id of topLevelIds) {
      if (!baseSet.has(id) && !hiddenSet.has(id)) {
        baseVisible.push(id);
        baseSet.add(id);
      }
    }
  }

  const activeSessionId = args.activeSessionId ?? null;
  if (activeSessionId && liveSet.has(activeSessionId) && !baseSet.has(activeSessionId)) {
    baseVisible.push(activeSessionId);
    baseSet.add(activeSessionId);
  }

  const visibleSessionIds = enforceParentAnchors({
    visibleIds: baseVisible,
    childToParent,
    liveSet,
  });

  return {
    visibleSessionIds,
    prunedPersistedVisibleIds,
    prunedRecentlyHiddenIds,
  };
}

export function enforceParentAnchors(args: {
  visibleIds: string[];
  childToParent: Map<string, string>;
  liveSet: Set<string>;
}): string[] {
  const next: string[] = [];
  const nextSet = new Set<string>();

  for (const id of uniqueIds(args.visibleIds)) {
    if (!args.liveSet.has(id)) {
      continue;
    }

    const parentId = args.childToParent.get(id);
    if (parentId && args.liveSet.has(parentId) && !nextSet.has(parentId)) {
      next.push(parentId);
      nextSet.add(parentId);
    }

    if (!nextSet.has(id)) {
      next.push(id);
      nextSet.add(id);
    }
  }

  return next;
}

export function resolveFallbackAfterHidingChatTabs(args: {
  visibleIdsBeforeHide: string[];
  idsToHide: string[];
  activeSessionId: string | null;
}): string | null {
  const hideSet = new Set(args.idsToHide);
  if (!args.activeSessionId || !hideSet.has(args.activeSessionId)) {
    return args.activeSessionId;
  }

  const activeIndex = args.visibleIdsBeforeHide.indexOf(args.activeSessionId);
  const remaining = args.visibleIdsBeforeHide.filter((id) => !hideSet.has(id));
  if (remaining.length === 0) {
    return null;
  }

  if (activeIndex === -1) {
    return remaining[0] ?? null;
  }

  return remaining[Math.min(activeIndex, remaining.length - 1)] ?? null;
}

export function resolveMostRecentHiddenChatTab(args: {
  recentlyHiddenIds: string[];
  liveIds: string[];
  visibleIds: string[];
}): string | null {
  const liveSet = new Set(args.liveIds);
  const visibleSet = new Set(args.visibleIds);
  return args.recentlyHiddenIds.find((id) => liveSet.has(id) && !visibleSet.has(id)) ?? null;
}

export function collectGroupIds(args: {
  rootSessionId: string;
  visibleIds: string[];
  childToParent: Map<string, string>;
}): string[] {
  return args.visibleIds.filter((id) =>
    id === args.rootSessionId || args.childToParent.get(id) === args.rootSessionId
  );
}
