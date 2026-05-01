import { useEffect, useMemo } from "react";
import { useWorkspaceSessionsQuery } from "@anyharness/sdk-react";
import {
  useWorkspaceHeaderSubagentHierarchy,
} from "@/hooks/workspaces/tabs/use-workspace-header-subagent-hierarchy";
import {
  collectHierarchyChildren,
  getKnownSessionAgentKind,
  getKnownSessionId,
  getKnownSessionTitle,
  getKnownSessionViewState,
  getLinkedChildViewState,
  type KnownHeaderSession,
} from "@/hooks/workspaces/tabs/workspace-header-tabs-model-helpers";
import {
  buildGroupedChatTabs,
  type GroupedChatTab,
} from "@/lib/domain/workspaces/tabs/grouping";
import {
  buildHeaderStripRows,
  type HeaderStripRow,
} from "@/lib/domain/workspaces/tabs/group-rows";
import {
  type HeaderShellStripRow,
} from "@/lib/domain/workspaces/tabs/shell-rows";
import {
  deriveManualChatGroupsForDisplay,
  isManualChatGroupId,
  normalizeManualChatGroupsForMutation,
  resolveManualChatGroupColor,
  type ManualChatGroupId,
} from "@/lib/domain/workspaces/tabs/manual-groups";
import {
  includeVisibleLinkedChildSessionIds,
  resolveVisibleChatSessionIds,
  type ChatVisibilityCandidate,
} from "@/lib/domain/workspaces/tabs/visibility";
import {
  type SessionViewState,
  sessionSlotBelongsToWorkspace,
} from "@/lib/domain/sessions/activity";
import {
  useWorkspaceActiveChatTabId,
  useWorkspaceShellTabsState,
} from "@/hooks/workspaces/tabs/use-workspace-shell-tabs-state";
import { parseWorkspaceShellTabKey } from "@/lib/domain/workspaces/tabs/shell-tabs";
import {
  useWorkspaceFilesStore,
  type WorkspaceFileBuffer,
} from "@/stores/editor/workspace-files-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useIsHotPaintGatePendingForWorkspace } from "@/hooks/workspaces/use-hot-paint-gate";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";
import { resolveSelectedWorkspaceIdentity } from "@/lib/domain/workspaces/workspace-ui-key";
import {
  resolveWithWorkspaceFallback,
  sameStringArray,
} from "@/lib/domain/workspaces/workspace-keyed-preferences";

export interface HeaderChatTabEntry extends GroupedChatTab {
  id: string;
  title: string;
  agentKind: string;
  viewState: SessionViewState;
  isReviewAgentChild: boolean;
  isActive: boolean;
  groupColor: string | null;
  visualGroupId: string | null;
  manualGroupId: ManualChatGroupId | null;
  isHierarchyResolved: boolean;
}

export interface HeaderChatMenuEntry {
  id: string;
  title: string;
  agentKind: string;
  viewState: SessionViewState;
  isActive: boolean;
  isVisible: boolean;
}

export type HeaderChatStripRow = HeaderStripRow<HeaderChatTabEntry>;
export type HeaderWorkspaceShellStripRow = HeaderShellStripRow<HeaderChatTabEntry>;

const EMPTY_OPEN_TABS: string[] = [];
type WorkspaceFileTabMode = "edit" | "diff";

const EMPTY_BUFFERS_BY_PATH: Record<string, WorkspaceFileBuffer> = {};
const EMPTY_TAB_MODES: Record<string, WorkspaceFileTabMode> = {};

export function useWorkspaceHeaderTabsViewModel() {
  const rawOpenTabs = useWorkspaceFilesStore((s) => s.openTabs);
  const rawBuffersByPath = useWorkspaceFilesStore((s) => s.buffersByPath);
  const rawTabModes = useWorkspaceFilesStore((s) => s.tabModes);
  const fileStoreMaterializedWorkspaceId = useWorkspaceFilesStore(
    (s) => s.materializedWorkspaceId,
  );

  const selectedWorkspaceId = useHarnessStore((s) => s.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useLogicalWorkspaceStore(
    (s) => s.selectedLogicalWorkspaceId,
  );
  const selectedIdentity = resolveSelectedWorkspaceIdentity({
    selectedLogicalWorkspaceId,
    materializedWorkspaceId: selectedWorkspaceId,
  });
  const { workspaceUiKey, materializedWorkspaceId } = selectedIdentity;
  const isFileStoreCurrent = Boolean(
    materializedWorkspaceId
      && fileStoreMaterializedWorkspaceId === materializedWorkspaceId,
  );
  const openTabs = isFileStoreCurrent ? rawOpenTabs : EMPTY_OPEN_TABS;
  const buffersByPath = isFileStoreCurrent ? rawBuffersByPath : EMPTY_BUFFERS_BY_PATH;
  const tabModes = isFileStoreCurrent ? rawTabModes : EMPTY_TAB_MODES;
  const hotPaintPending = useIsHotPaintGatePendingForWorkspace(selectedWorkspaceId);
  const activeSessionId = useHarnessStore((s) => s.activeSessionId);
  const sessionSlots = useHarnessStore((s) => s.sessionSlots);

  const visibleByWorkspace = useWorkspaceUiStore((s) => s.visibleChatSessionIdsByWorkspace);
  const hiddenByWorkspace = useWorkspaceUiStore((s) => s.recentlyHiddenChatSessionIdsByWorkspace);
  const collapsedGroupsByWorkspace = useWorkspaceUiStore((s) => s.collapsedChatGroupsByWorkspace);
  const manualGroupsByWorkspace = useWorkspaceUiStore((s) => s.manualChatGroupsByWorkspace);
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

  const workspaceSessionsQuery = useWorkspaceSessionsQuery({
    workspaceId: selectedWorkspaceId,
    enabled: !!selectedWorkspaceId && !hotPaintPending,
  });

  const liveSlots = useMemo(
    () => Object.values(sessionSlots)
      .filter((slot) => sessionSlotBelongsToWorkspace(slot, selectedWorkspaceId)),
    [selectedWorkspaceId, sessionSlots],
  );
  const knownSessions = useMemo<Map<string, KnownHeaderSession>>(() => {
    const map = new Map<string, KnownHeaderSession>();
    for (const session of workspaceSessionsQuery.data ?? []) {
      if (session.dismissedAt) continue;
      if (!selectedWorkspaceId || session.workspaceId !== selectedWorkspaceId) continue;
      map.set(session.id, { kind: "session", session });
    }
    for (const slot of liveSlots) {
      map.set(slot.sessionId, { kind: "slot", slot });
    }
    return map;
  }, [liveSlots, selectedWorkspaceId, workspaceSessionsQuery.data]);
  const knownSessionIds = useMemo(() => Array.from(knownSessions.keys()), [knownSessions]);
  const hierarchy = useWorkspaceHeaderSubagentHierarchy({
    workspaceId: selectedWorkspaceId,
    sessionIds: knownSessionIds,
    activeSessionId,
  });
  const hierarchyChildren = useMemo(
    () => collectHierarchyChildren(hierarchy.childrenByParentSessionId),
    [hierarchy.childrenByParentSessionId],
  );

  const liveVisibilityCandidates = useMemo<ChatVisibilityCandidate[]>(
    () => {
      const candidatesBySessionId = new Map<string, ChatVisibilityCandidate>();
      for (const sessionId of knownSessionIds) {
        candidatesBySessionId.set(sessionId, {
          sessionId,
          parentSessionId: hierarchy.childToParent.get(sessionId) ?? null,
        });
      }
      for (const candidate of hierarchyChildren.visibilityCandidates) {
        candidatesBySessionId.set(candidate.sessionId, candidate);
      }
      return Array.from(candidatesBySessionId.values());
    },
    [hierarchy.childToParent, hierarchyChildren.visibilityCandidates, knownSessionIds],
  );
  const liveChatSessionIds = useMemo(
    () => liveVisibilityCandidates.map((candidate) => candidate.sessionId),
    [liveVisibilityCandidates],
  );

  const persistedVisibleFallback = resolveWithWorkspaceFallback(
    visibleByWorkspace,
    workspaceUiKey,
    materializedWorkspaceId,
  );
  const recentlyHiddenFallback = resolveWithWorkspaceFallback(
    hiddenByWorkspace,
    workspaceUiKey,
    materializedWorkspaceId,
  );
  const collapsedParentFallback = resolveWithWorkspaceFallback(
    collapsedGroupsByWorkspace,
    workspaceUiKey,
    materializedWorkspaceId,
  );
  const manualGroupsFallback = resolveWithWorkspaceFallback(
    manualGroupsByWorkspace,
    workspaceUiKey,
    materializedWorkspaceId,
  );
  const persistedVisibleIds = persistedVisibleFallback.value;
  const recentlyHiddenIds = recentlyHiddenFallback.value ?? [];
  const collapsedParentIds = collapsedParentFallback.value ?? [];
  const persistedManualGroups = manualGroupsFallback.value ?? [];
  const activeChatSessionIdForTabs = useWorkspaceActiveChatTabId({
    workspaceUiKey,
    materializedWorkspaceId,
    fallbackSessionId: activeSessionId,
  });
  const persistedVisibleIdsForResolution = useMemo(
    () => persistedVisibleIds?.filter((sessionId) =>
      sessionId === activeSessionId || !hierarchyChildren.rowsBySessionId.has(sessionId)
    ),
    [activeSessionId, hierarchyChildren.rowsBySessionId, persistedVisibleIds],
  );

  const visibleResolution = useMemo(
    () => resolveVisibleChatSessionIds({
      liveSessions: liveVisibilityCandidates,
      persistedVisibleIds: persistedVisibleIdsForResolution,
      recentlyHiddenIds,
      activeSessionId,
    }),
    [
      activeSessionId,
      liveVisibilityCandidates,
      persistedVisibleIdsForResolution,
      recentlyHiddenIds,
    ],
  );
  const visibleChatSessionIds = visibleResolution.visibleSessionIds;
  const stripVisibleChatSessionIds = useMemo(
    () => includeVisibleLinkedChildSessionIds({
      visibleSessionIds: visibleResolution.visibleSessionIds,
      linkedChildrenByParentSessionId: hierarchyChildren.childIdsByParentSessionId,
      recentlyHiddenIds,
    }),
    [
      hierarchyChildren.childIdsByParentSessionId,
      recentlyHiddenIds,
      visibleResolution.visibleSessionIds,
    ],
  );

  const workspaceSessionsLoaded = workspaceSessionsQuery.data !== undefined;

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

    useWorkspaceUiStore.setState((state) => ({
      visibleChatSessionIdsByWorkspace:
        persistedVisibleFallback.shouldWriteBack && persistedVisibleFallback.value !== undefined
          ? {
              ...state.visibleChatSessionIdsByWorkspace,
              [workspaceUiKey]: persistedVisibleFallback.value,
            }
          : state.visibleChatSessionIdsByWorkspace,
      recentlyHiddenChatSessionIdsByWorkspace:
        recentlyHiddenFallback.shouldWriteBack && recentlyHiddenFallback.value !== undefined
          ? {
              ...state.recentlyHiddenChatSessionIdsByWorkspace,
              [workspaceUiKey]: recentlyHiddenFallback.value,
            }
          : state.recentlyHiddenChatSessionIdsByWorkspace,
      collapsedChatGroupsByWorkspace:
        collapsedParentFallback.shouldWriteBack && collapsedParentFallback.value !== undefined
          ? {
              ...state.collapsedChatGroupsByWorkspace,
              [workspaceUiKey]: collapsedParentFallback.value,
            }
          : state.collapsedChatGroupsByWorkspace,
      manualChatGroupsByWorkspace:
        manualGroupsFallback.shouldWriteBack && manualGroupsFallback.value !== undefined
          ? {
              ...state.manualChatGroupsByWorkspace,
              [workspaceUiKey]: manualGroupsFallback.value,
            }
          : state.manualChatGroupsByWorkspace,
    }));
  }, [
    collapsedParentFallback.shouldWriteBack,
    collapsedParentFallback.value,
    manualGroupsFallback.shouldWriteBack,
    manualGroupsFallback.value,
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
      // Only write back if we're adding, or if the workspace sessions list has
      // loaded (so we're confident any "removed" ids were truly dismissed and
      // not just not-yet-hydrated). This keeps a partial in-memory view from
      // overwriting good persisted state during startup.
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
    if (!sameStringArray(recentlyHiddenIds, visibleResolution.prunedRecentlyHiddenIds)) {
      const staleHiddenIds = recentlyHiddenIds.filter(
        (id) => !visibleResolution.prunedRecentlyHiddenIds.includes(id),
      );
      if (staleHiddenIds.length > 0 && workspaceSessionsLoaded) {
        clearHiddenChatSessionsForWorkspace(workspaceUiKey, staleHiddenIds);
      }
    }
  }, [
    clearHiddenChatSessionsForWorkspace,
    persistedVisibleIds,
    recentlyHiddenIds,
    setVisibleChatSessionIdsForWorkspace,
    visibleChatSessionIds,
    visibleResolution.prunedRecentlyHiddenIds,
    workspaceUiKey,
    workspaceSessionsLoaded,
  ]);

  const groupedTabs = useMemo(
    () => buildGroupedChatTabs({
      visibleSessionIds: stripVisibleChatSessionIds,
      childToParent: hierarchy.childToParent,
    }),
    [hierarchy.childToParent, stripVisibleChatSessionIds],
  );
  const displayManualGroups = useMemo(
    () => deriveManualChatGroupsForDisplay({
      groups: persistedManualGroups,
      visibleSessionIds: stripVisibleChatSessionIds,
      childToParent: hierarchy.childToParent,
      resolvedHierarchySessionIds: hierarchy.resolvedSessionIds,
    }),
    [
      hierarchy.childToParent,
      hierarchy.resolvedSessionIds,
      persistedManualGroups,
      stripVisibleChatSessionIds,
    ],
  );
  const manualGroupByTopLevelSessionId = useMemo(() => {
    const map = new Map<string, (typeof displayManualGroups)[number]>();
    for (const group of displayManualGroups) {
      for (const sessionId of group.sessionIds) {
        map.set(sessionId, group);
      }
    }
    return map;
  }, [displayManualGroups]);
  const chatTabs = useMemo<HeaderChatTabEntry[]>(
    () => groupedTabs
      .map((grouped) => {
        const known = knownSessions.get(grouped.sessionId);
        const hierarchyChild = hierarchyChildren.rowsBySessionId.get(grouped.sessionId);
        if (!known && !hierarchyChild) {
          return null;
        }
        const manualGroup = manualGroupByTopLevelSessionId.get(
          grouped.isChild ? grouped.groupRootSessionId : grouped.sessionId,
        ) ?? null;
        const isSubagentGrouped =
          grouped.isChild || hierarchy.childrenByParentSessionId.has(grouped.sessionId);
        const groupColor = manualGroup
          ? resolveManualChatGroupColor(manualGroup.colorId)
          : null;
        return {
          ...grouped,
          id: grouped.sessionId,
          title: known ? getKnownSessionTitle(known) : hierarchyChild!.title,
          agentKind: known ? getKnownSessionAgentKind(known) : hierarchyChild!.agentKind,
          viewState: known
            ? getKnownSessionViewState(known)
            : getLinkedChildViewState(hierarchyChild!),
          isReviewAgentChild: hierarchyChild?.source === "review",
          isActive: grouped.sessionId === activeChatSessionIdForTabs,
          groupColor,
          visualGroupId: manualGroup?.id ?? (isSubagentGrouped ? grouped.groupRootSessionId : null),
          manualGroupId: manualGroup?.id ?? null,
          isHierarchyResolved: hierarchy.resolvedSessionIds.has(grouped.sessionId),
        } satisfies HeaderChatTabEntry;
      })
      .filter((tab): tab is HeaderChatTabEntry => !!tab),
    [
      activeChatSessionIdForTabs,
      groupedTabs,
      hierarchyChildren.rowsBySessionId,
      hierarchy.childrenByParentSessionId,
      hierarchy.resolvedSessionIds,
      knownSessions,
      manualGroupByTopLevelSessionId,
    ],
  );

  const stripRows = useMemo(
    () => buildHeaderStripRows({
      groupedTabs: chatTabs,
      childrenByParentSessionId: hierarchy.childrenByParentSessionId,
      collapsedGroupIds: collapsedParentIds,
      resolveManualGroupColor: (group) => resolveManualChatGroupColor(group.colorId),
      manualGroups: displayManualGroups,
      activeSessionId,
      subagentLabel: "Agents",
    }),
    [
      activeSessionId,
      chatTabs,
      collapsedParentIds,
      displayManualGroups,
      hierarchy.childrenByParentSessionId,
    ],
  );
  const stripChatSessionIds = useMemo(
    () => stripRows
      .filter((row): row is Extract<HeaderChatStripRow, { kind: "tab" }> => row.kind === "tab")
      .filter((row) => !row.tab.isReviewAgentChild)
      .map((row) => row.tab.sessionId),
    [stripRows],
  );
  const {
    activeShellTab,
    activeShellTabKey,
    activation,
    shellRows,
    orderedTabs,
    orderedShellTabKeys,
  } = useWorkspaceShellTabsState({
    workspaceUiKey,
    materializedWorkspaceId,
    activeSessionId,
    shellChatSessionIds: stripVisibleChatSessionIds,
    openTabs,
    stripRows,
    displayManualGroups,
    subagentChildIdsByParentId: hierarchyChildren.childIdsByParentSessionId,
  });
  const highlightedChatSessionId = useMemo(() => {
    const highlighted = activation.highlightedTabKey ? parseWorkspaceShellTabKey(activation.highlightedTabKey) : null;
    return highlighted?.kind === "chat" ? highlighted.sessionId : null;
  }, [activation.highlightedTabKey]);
  const displayShellRows = useMemo<HeaderWorkspaceShellStripRow[]>(
    () => shellRows.map((shellRow) => {
      if (shellRow.kind !== "chat" || shellRow.row.kind !== "tab") {
        return shellRow;
      }
      return {
        ...shellRow,
        row: {
          ...shellRow.row,
          tab: {
            ...shellRow.row.tab,
            isActive: shellRow.row.tab.sessionId === highlightedChatSessionId,
          },
        },
      };
    }),
    [highlightedChatSessionId, shellRows],
  );

  useEffect(() => {
    if (!workspaceUiKey || collapsedParentIds.length === 0) {
      return;
    }
    const manualGroupIds = new Set(persistedManualGroups.map((group) => group.id));
    const activeParentId = activeSessionId
      ? hierarchy.childToParent.get(activeSessionId) ?? activeSessionId
      : null;
    const staleOrActiveIds = collapsedParentIds.filter((groupId) => {
      if (isManualChatGroupId(groupId)) {
        const group = persistedManualGroups.find((candidate) => candidate.id === groupId);
        return !manualGroupIds.has(groupId)
          || (!!activeParentId && !!group && group.sessionIds.includes(activeParentId));
      }
      return !hierarchy.childrenByParentSessionId.has(groupId)
        || (!!activeParentId && groupId === activeParentId);
    });
    if (staleOrActiveIds.length > 0) {
      clearChatGroupCollapsedForWorkspace(workspaceUiKey, staleOrActiveIds);
    }
  }, [
    activeSessionId,
    clearChatGroupCollapsedForWorkspace,
    collapsedParentIds,
    hierarchy.childToParent,
    hierarchy.childrenByParentSessionId,
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
        !knownSessionIdSet.has(sessionId) || hierarchy.resolvedSessionIds.has(sessionId)
      )
    );
    if (!canCleanup) {
      return;
    }
    const normalized = normalizeManualChatGroupsForMutation({
      groups: persistedManualGroups,
      liveSessionIds: knownSessionIds,
      childToParent: hierarchy.childToParent,
      resolvedHierarchySessionIds: hierarchy.resolvedSessionIds,
    });
    if (JSON.stringify(normalized) !== JSON.stringify(persistedManualGroups)) {
      setManualChatGroupsForWorkspace(workspaceUiKey, normalized);
    }
  }, [
    hierarchy.childToParent,
    hierarchy.resolvedSessionIds,
    knownSessionIds,
    persistedManualGroups,
    setManualChatGroupsForWorkspace,
    workspaceUiKey,
    workspaceSessionsLoaded,
  ]);

  const menuChatTabs = useMemo<HeaderChatMenuEntry[]>(
    () => Array.from(knownSessions.values())
      .filter((known) => !hierarchy.childToParent.has(getKnownSessionId(known)))
      .map((known) => {
        const id = getKnownSessionId(known);
        return {
          id,
          title: getKnownSessionTitle(known),
          agentKind: getKnownSessionAgentKind(known),
          viewState: getKnownSessionViewState(known),
          isActive: id === highlightedChatSessionId,
          isVisible: visibleChatSessionIds.includes(id),
        };
      }),
    [
      highlightedChatSessionId,
      hierarchy.childToParent,
      knownSessions,
      visibleChatSessionIds,
    ],
  );

  return {
    activeSessionId,
    activeShellTab,
    activeShellTabKey,
    activation,
    selectedWorkspaceId,
    workspaceUiKey,
    materializedWorkspaceId,
    openTabs,
    buffersByPath,
    tabModes,
    chatTabs,
    stripRows,
    shellRows: displayShellRows,
    orderedTabs,
    orderedShellTabKeys,
    stripChatSessionIds,
    menuChatTabs,
    visibleChatSessionIds,
    liveChatSessionIds,
    childToParent: hierarchy.childToParent,
    childrenByParentSessionId: hierarchy.childrenByParentSessionId,
    hierarchyResolvedSessionIds: hierarchy.resolvedSessionIds,
    displayManualGroups,
  };
}
