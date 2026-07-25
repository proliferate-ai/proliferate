import { useEffect } from "react";
import {
  isManualChatGroupId,
  normalizeManualChatGroupsForMutation,
  type ManualChatGroup,
} from "@/lib/domain/workspaces/tabs/manual-groups";
import {
  sameStringArray,
  type WorkspaceFallbackResult,
} from "@/lib/domain/workspaces/selection/workspace-keyed-preferences";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";

export function useWorkspaceHeaderTabsPreferenceEffects({
  workspaceUiKey,
  persistedVisibleFallback,
  recentlyHiddenFallback,
  collapsedParentFallback,
  manualGroupsFallback,
  persistedVisibleIds,
  recentlyHiddenIds,
  visibleChatSessionIds,
  prunedRecentlyHiddenIds,
  workspaceSessionsLoaded,
  collapsedParentIds,
  persistedManualGroups,
  activeSessionId,
  childToParent,
  childrenByParentSessionId,
  knownSessionIds,
  resolvedHierarchySessionIds,
}: {
  workspaceUiKey: string | null;
  persistedVisibleFallback: WorkspaceFallbackResult<string[]>;
  recentlyHiddenFallback: WorkspaceFallbackResult<string[]>;
  collapsedParentFallback: WorkspaceFallbackResult<string[]>;
  manualGroupsFallback: WorkspaceFallbackResult<ManualChatGroup[]>;
  persistedVisibleIds: string[] | undefined;
  recentlyHiddenIds: string[];
  visibleChatSessionIds: string[];
  prunedRecentlyHiddenIds: string[];
  workspaceSessionsLoaded: boolean;
  collapsedParentIds: string[];
  persistedManualGroups: ManualChatGroup[];
  activeSessionId: string | null;
  childToParent: ReadonlyMap<string, string>;
  childrenByParentSessionId: ReadonlyMap<string, readonly unknown[]>;
  knownSessionIds: string[];
  resolvedHierarchySessionIds: ReadonlySet<string>;
}): void {
  const setVisibleChatSessionIdsForWorkspace = useWorkspaceUiStore(
    (s) => s.setVisibleChatSessionIdsForWorkspace,
  );
  const clearHiddenChatSessionsForWorkspace = useWorkspaceUiStore(
    (s) => s.clearHiddenChatSessionsForWorkspace,
  );
  const clearChatGroupCollapsedForWorkspace = useWorkspaceUiStore(
    (s) => s.clearChatGroupCollapsedForWorkspace,
  );
  const setManualChatGroupsForWorkspace = useWorkspaceUiStore(
    (s) => s.setManualChatGroupsForWorkspace,
  );
  const materializeWorkspaceHeaderTabFallbacks = useWorkspaceUiStore(
    (s) => s.materializeWorkspaceHeaderTabFallbacks,
  );

  useEffect(() => {
    if (!workspaceUiKey) {
      return;
    }
    const shouldMaterialize =
      (persistedVisibleFallback.shouldWriteBack && persistedVisibleFallback.value !== undefined)
      || (recentlyHiddenFallback.shouldWriteBack && recentlyHiddenFallback.value !== undefined)
      || (collapsedParentFallback.shouldWriteBack && collapsedParentFallback.value !== undefined)
      || (manualGroupsFallback.shouldWriteBack && manualGroupsFallback.value !== undefined);
    if (!shouldMaterialize) {
      return;
    }

    const fallback: Parameters<
      typeof materializeWorkspaceHeaderTabFallbacks
    >[1] = {};
    if (
      persistedVisibleFallback.shouldWriteBack
      && persistedVisibleFallback.value !== undefined
    ) {
      fallback.visibleChatSessionIds = persistedVisibleFallback.value;
    }
    if (
      recentlyHiddenFallback.shouldWriteBack
      && recentlyHiddenFallback.value !== undefined
    ) {
      fallback.recentlyHiddenChatSessionIds = recentlyHiddenFallback.value;
    }
    if (
      collapsedParentFallback.shouldWriteBack
      && collapsedParentFallback.value !== undefined
    ) {
      fallback.collapsedChatGroupIds = collapsedParentFallback.value;
    }
    if (
      manualGroupsFallback.shouldWriteBack
      && manualGroupsFallback.value !== undefined
    ) {
      fallback.manualChatGroups = manualGroupsFallback.value;
    }
    materializeWorkspaceHeaderTabFallbacks(workspaceUiKey, fallback);
  }, [
    collapsedParentFallback.shouldWriteBack,
    collapsedParentFallback.value,
    manualGroupsFallback.shouldWriteBack,
    manualGroupsFallback.value,
    materializeWorkspaceHeaderTabFallbacks,
    persistedVisibleFallback.shouldWriteBack,
    persistedVisibleFallback.value,
    recentlyHiddenFallback.shouldWriteBack,
    recentlyHiddenFallback.value,
    workspaceUiKey,
  ]);

  useEffect(() => {
    if (!workspaceUiKey) {
      return;
    }
    if (!sameStringArray(persistedVisibleIds ?? [], visibleChatSessionIds)) {
      const previousIds = persistedVisibleIds ?? [];
      const isSuperset = previousIds.every((id) =>
        visibleChatSessionIds.includes(id)
      );
      if (isSuperset || workspaceSessionsLoaded) {
        setVisibleChatSessionIdsForWorkspace(
          workspaceUiKey,
          visibleChatSessionIds,
        );
      }
    }
    if (!sameStringArray(recentlyHiddenIds, prunedRecentlyHiddenIds)) {
      const staleHiddenIds = recentlyHiddenIds.filter(
        (id) => !prunedRecentlyHiddenIds.includes(id),
      );
      if (staleHiddenIds.length > 0 && workspaceSessionsLoaded) {
        clearHiddenChatSessionsForWorkspace(workspaceUiKey, staleHiddenIds);
      }
    }
  }, [
    clearHiddenChatSessionsForWorkspace,
    persistedVisibleIds,
    prunedRecentlyHiddenIds,
    recentlyHiddenIds,
    setVisibleChatSessionIdsForWorkspace,
    visibleChatSessionIds,
    workspaceUiKey,
    workspaceSessionsLoaded,
  ]);

  useEffect(() => {
    if (!workspaceUiKey || collapsedParentIds.length === 0) {
      return;
    }
    const manualGroupIds = new Set(persistedManualGroups.map((group) => group.id));
    const activeParentId = activeSessionId
      ? childToParent.get(activeSessionId) ?? activeSessionId
      : null;
    const staleOrActiveIds = collapsedParentIds.filter((groupId) => {
      if (isManualChatGroupId(groupId)) {
        const group = persistedManualGroups.find((candidate) => candidate.id === groupId);
        return !manualGroupIds.has(groupId)
          || (!!activeParentId && !!group && group.sessionIds.includes(activeParentId));
      }
      return !childrenByParentSessionId.has(groupId)
        || (!!activeParentId && groupId === activeParentId);
    });
    if (staleOrActiveIds.length > 0) {
      clearChatGroupCollapsedForWorkspace(workspaceUiKey, staleOrActiveIds);
    }
  }, [
    activeSessionId,
    childToParent,
    childrenByParentSessionId,
    clearChatGroupCollapsedForWorkspace,
    collapsedParentIds,
    persistedManualGroups,
    workspaceUiKey,
  ]);

  useEffect(() => {
    if (!workspaceUiKey || !workspaceSessionsLoaded || persistedManualGroups.length === 0) {
      return;
    }
    const knownSessionIdSet = new Set(knownSessionIds);
    const canCleanup = persistedManualGroups.every((group) =>
      group.sessionIds.every((sessionId) =>
        !knownSessionIdSet.has(sessionId) || resolvedHierarchySessionIds.has(sessionId)
      )
    );
    if (!canCleanup) {
      return;
    }
    const normalized = normalizeManualChatGroupsForMutation({
      groups: persistedManualGroups,
      liveSessionIds: knownSessionIds,
      childToParent,
      resolvedHierarchySessionIds,
    });
    if (JSON.stringify(normalized) !== JSON.stringify(persistedManualGroups)) {
      setManualChatGroupsForWorkspace(workspaceUiKey, normalized);
    }
  }, [
    childToParent,
    knownSessionIds,
    persistedManualGroups,
    resolvedHierarchySessionIds,
    setManualChatGroupsForWorkspace,
    workspaceUiKey,
    workspaceSessionsLoaded,
  ]);
}
