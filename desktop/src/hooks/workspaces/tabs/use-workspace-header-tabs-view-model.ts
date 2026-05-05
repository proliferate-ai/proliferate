import { useEffect, useMemo } from "react";
import { useWorkspaceSessionsQuery } from "@anyharness/sdk-react";
import { useWorkspaceHeaderSubagentHierarchy } from "@/hooks/workspaces/tabs/use-workspace-header-subagent-hierarchy";
import {
  collectHierarchyChildren,
  getKnownSessionCanFork,
  getKnownSessionAgentKind,
  getKnownSessionId,
  getKnownSessionTitle,
  getKnownSessionViewState,
  getLinkedChildViewState,
  type KnownHeaderSession,
} from "@/hooks/workspaces/tabs/workspace-header-tabs-model-helpers";
import { buildGroupedChatTabs, type GroupedChatTab } from "@/lib/domain/workspaces/tabs/grouping";
import { buildHeaderStripRows, type HeaderStripRow } from "@/lib/domain/workspaces/tabs/group-rows";
import { type HeaderShellStripRow } from "@/lib/domain/workspaces/tabs/shell-rows";
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
import type {
  FileViewerMode,
  ViewerTarget,
} from "@/lib/domain/workspaces/viewer-target";
import {
  useWorkspaceFileBuffersStore,
  type WorkspaceFileBuffer,
} from "@/stores/editor/workspace-file-buffers-store";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useHarnessStore, type SessionSlot } from "@/stores/sessions/harness-store";
import { useIsHotPaintGatePendingForWorkspace } from "@/hooks/workspaces/use-hot-paint-gate";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";
import { resolveSelectedWorkspaceIdentity } from "@/lib/domain/workspaces/workspace-ui-key";
import {
  resolveWithWorkspaceFallback,
  sameStringArray,
} from "@/lib/domain/workspaces/workspace-keyed-preferences";
import { useDebugValueChange } from "@/hooks/ui/use-debug-value-change";
import { measureDebugComputation } from "@/lib/infra/debug-measurement";

export interface HeaderChatTabEntry extends GroupedChatTab {
  id: string;
  title: string;
  agentKind: string;
  viewState: SessionViewState;
  canFork: boolean;
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

const EMPTY_OPEN_TARGETS: ViewerTarget[] = [];

const EMPTY_BUFFERS_BY_PATH: Record<string, WorkspaceFileBuffer> = {};
const EMPTY_TAB_MODES: Record<string, FileViewerMode> = {};
const EMPTY_LIVE_SLOTS: SessionSlot[] = [];

export function useWorkspaceHeaderTabsViewModel() {
  const rawOpenTargets = useWorkspaceViewerTabsStore((s) => s.openTargets);
  const rawBuffersByPath = useWorkspaceFileBuffersStore((s) => s.buffersByPath);
  const rawTabModes = useWorkspaceViewerTabsStore((s) => s.modeByTargetKey);
  const viewerStoreMaterializedWorkspaceId = useWorkspaceViewerTabsStore(
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
  const isViewerStoreCurrent = Boolean(
    materializedWorkspaceId
      && viewerStoreMaterializedWorkspaceId === materializedWorkspaceId,
  );
  const openTargets = isViewerStoreCurrent ? rawOpenTargets : EMPTY_OPEN_TARGETS;
  const buffersByPath = isViewerStoreCurrent ? rawBuffersByPath : EMPTY_BUFFERS_BY_PATH;
  const tabModes = isViewerStoreCurrent ? rawTabModes : EMPTY_TAB_MODES;
  const hotPaintPending = useIsHotPaintGatePendingForWorkspace(selectedWorkspaceId);
  const activeSessionId = useHarnessStore((s) => s.activeSessionId);
  const liveSlotsSelector = useMemo(
    () => createWorkspaceHeaderLiveSlotsSelector(selectedWorkspaceId),
    [selectedWorkspaceId],
  );
  const liveSlots = useHarnessStore(liveSlotsSelector);

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

  const knownSessions = useMemo<Map<string, KnownHeaderSession>>(() =>
    measureDebugComputation({
      category: "header_tabs.derive",
      label: "known_sessions",
      keys: ["liveSlots", "workspaceSessionsQuery.data", "selectedWorkspaceId"],
      count: (map) => map.size,
    }, () => {
      const map = new Map<string, KnownHeaderSession>();
      for (const session of workspaceSessionsQuery.data ?? []) {
        if (session.dismissedAt) continue;
        if (!selectedWorkspaceId || session.workspaceId !== selectedWorkspaceId) continue;
        map.set(session.id, { kind: "session", session });
      }
      for (const slot of liveSlots) {
        const existing = map.get(slot.sessionId);
        map.set(slot.sessionId, {
          kind: "slot",
          slot,
          session: existing?.kind === "session" ? existing.session : existing?.session,
        });
      }
      return map;
    }), [liveSlots, selectedWorkspaceId, workspaceSessionsQuery.data]);
  const knownSessionIds = useMemo(() => Array.from(knownSessions.keys()), [knownSessions]);
  const hierarchy = useWorkspaceHeaderSubagentHierarchy({
    workspaceId: selectedWorkspaceId,
    sessionIds: knownSessionIds,
    activeSessionId,
  });
  const hierarchyChildren = useMemo(
    () => measureDebugComputation({
      category: "header_tabs.derive",
      label: "hierarchy_children",
      keys: ["hierarchy.childrenByParentSessionId"],
      count: (children) => children.visibilityCandidates.length,
    }, () => collectHierarchyChildren(hierarchy.childrenByParentSessionId)),
    [hierarchy.childrenByParentSessionId],
  );

  const liveVisibilityCandidates = useMemo<ChatVisibilityCandidate[]>(
    () => measureDebugComputation({
      category: "header_tabs.derive",
      label: "live_visibility_candidates",
      keys: ["knownSessionIds", "hierarchy.childToParent", "hierarchyChildren.visibilityCandidates"],
      count: (candidates) => candidates.length,
    }, () => {
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
    }),
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

    const state = useWorkspaceUiStore.getState();
    const patch: Partial<ReturnType<typeof useWorkspaceUiStore.getState>> = {};
    if (
      persistedVisibleFallback.shouldWriteBack
      && persistedVisibleFallback.value !== undefined
      && shouldWriteStringArrayPreference(
        state.visibleChatSessionIdsByWorkspace,
        workspaceUiKey,
        persistedVisibleFallback.value,
      )
    ) {
      patch.visibleChatSessionIdsByWorkspace = {
        ...state.visibleChatSessionIdsByWorkspace,
        [workspaceUiKey]: persistedVisibleFallback.value,
      };
    }
    if (
      recentlyHiddenFallback.shouldWriteBack
      && recentlyHiddenFallback.value !== undefined
      && shouldWriteStringArrayPreference(
        state.recentlyHiddenChatSessionIdsByWorkspace,
        workspaceUiKey,
        recentlyHiddenFallback.value,
      )
    ) {
      patch.recentlyHiddenChatSessionIdsByWorkspace = {
        ...state.recentlyHiddenChatSessionIdsByWorkspace,
        [workspaceUiKey]: recentlyHiddenFallback.value,
      };
    }
    if (
      collapsedParentFallback.shouldWriteBack
      && collapsedParentFallback.value !== undefined
      && shouldWriteStringArrayPreference(
        state.collapsedChatGroupsByWorkspace,
        workspaceUiKey,
        collapsedParentFallback.value,
      )
    ) {
      patch.collapsedChatGroupsByWorkspace = {
        ...state.collapsedChatGroupsByWorkspace,
        [workspaceUiKey]: collapsedParentFallback.value,
      };
    }
    if (
      manualGroupsFallback.shouldWriteBack
      && manualGroupsFallback.value !== undefined
      && shouldWriteReferencePreference(
        state.manualChatGroupsByWorkspace,
        workspaceUiKey,
        manualGroupsFallback.value,
      )
    ) {
      patch.manualChatGroupsByWorkspace = {
        ...state.manualChatGroupsByWorkspace,
        [workspaceUiKey]: manualGroupsFallback.value,
      };
    }
    if (Object.keys(patch).length > 0) {
      useWorkspaceUiStore.setState(patch);
    }
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
    () => measureDebugComputation({
      category: "header_tabs.derive",
      label: "chat_tabs",
      keys: [
        "activeChatSessionIdForTabs",
        "groupedTabs",
        "hierarchy",
        "knownSessions",
        "manualGroupByTopLevelSessionId",
      ],
      count: (tabs) => tabs.length,
    }, () => groupedTabs
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
          canFork: known ? getKnownSessionCanFork(known) : false,
          isReviewAgentChild: hierarchyChild?.source === "review",
          isActive: grouped.sessionId === activeChatSessionIdForTabs,
          groupColor,
          visualGroupId: manualGroup?.id ?? (isSubagentGrouped ? grouped.groupRootSessionId : null),
          manualGroupId: manualGroup?.id ?? null,
          isHierarchyResolved: hierarchy.resolvedSessionIds.has(grouped.sessionId),
        } satisfies HeaderChatTabEntry;
      })
      .filter((tab): tab is HeaderChatTabEntry => !!tab)),
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
    () => measureDebugComputation({
      category: "header_tabs.derive",
      label: "strip_rows",
      keys: ["activeSessionId", "chatTabs", "collapsedParentIds", "displayManualGroups"],
      count: (rows) => rows.length,
    }, () => buildHeaderStripRows({
      groupedTabs: chatTabs,
      childrenByParentSessionId: hierarchy.childrenByParentSessionId,
      collapsedGroupIds: collapsedParentIds,
      resolveManualGroupColor: (group) => resolveManualChatGroupColor(group.colorId),
      manualGroups: displayManualGroups,
      activeSessionId,
      subagentLabel: "Agents",
    })),
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
    openTargets,
    stripRows,
    displayManualGroups,
    subagentChildIdsByParentId: hierarchyChildren.childIdsByParentSessionId,
  });
  const highlightedChatSessionId = useMemo(() => {
    const highlighted = activation.highlightedTabKey ? parseWorkspaceShellTabKey(activation.highlightedTabKey) : null;
    return highlighted?.kind === "chat" ? highlighted.sessionId : null;
  }, [activation.highlightedTabKey]);
  const displayShellRows = useMemo<HeaderWorkspaceShellStripRow[]>(
    () => measureDebugComputation({
      category: "header_tabs.derive",
      label: "display_shell_rows",
      keys: ["highlightedChatSessionId", "shellRows"],
      count: (rows) => rows.length,
    }, () => shellRows.map((shellRow) => {
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
    })),
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
    () => measureDebugComputation({
      category: "header_tabs.derive",
      label: "menu_chat_tabs",
      keys: ["highlightedChatSessionId", "hierarchy.childToParent", "knownSessions", "visibleChatSessionIds"],
      count: (tabs) => tabs.length,
    }, () => Array.from(knownSessions.values())
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
      })),
    [
      highlightedChatSessionId,
      hierarchy.childToParent,
      knownSessions,
      visibleChatSessionIds,
    ],
  );

  useDebugValueChange("header_tabs.model", "view_model_refs", {
    selectedWorkspaceId,
    activeSessionId,
    hotPaintPending,
    liveSlots,
    knownSessions,
    hierarchyChildToParent: hierarchy.childToParent,
    hierarchyChildrenByParent: hierarchy.childrenByParentSessionId,
    chatTabs,
    stripRows,
    displayShellRows,
    menuChatTabs,
    activation,
  });

  return useMemo(() => ({
    activeSessionId,
    activeShellTab,
    activeShellTabKey,
    activation,
    selectedWorkspaceId,
    workspaceUiKey,
    materializedWorkspaceId,
    openTargets,
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
  }), [
    activeSessionId,
    activeShellTab,
    activeShellTabKey,
    activation,
    buffersByPath,
    chatTabs,
    displayManualGroups,
    hierarchy.childToParent,
    hierarchy.childrenByParentSessionId,
    hierarchy.resolvedSessionIds,
    liveChatSessionIds,
    materializedWorkspaceId,
    menuChatTabs,
    openTargets,
    orderedShellTabKeys,
    orderedTabs,
    selectedWorkspaceId,
    displayShellRows,
    stripChatSessionIds,
    stripRows,
    tabModes,
    visibleChatSessionIds,
    workspaceUiKey,
  ]);
}

type HarnessStoreSnapshot = ReturnType<typeof useHarnessStore.getState>;

function createWorkspaceHeaderLiveSlotsSelector(
  workspaceId: string | null,
): (state: HarnessStoreSnapshot) => SessionSlot[] {
  let previousSignature = "";
  let previousSlots = EMPTY_LIVE_SLOTS;

  return (state) => {
    if (!workspaceId) {
      previousSignature = "";
      previousSlots = EMPTY_LIVE_SLOTS;
      return EMPTY_LIVE_SLOTS;
    }

    const signature = buildWorkspaceHeaderLiveSlotsSignature(
      state.sessionSlots,
      workspaceId,
    );
    if (signature === previousSignature) {
      return previousSlots;
    }

    previousSignature = signature;
    previousSlots = Object.values(state.sessionSlots)
      .filter((slot) => sessionSlotBelongsToWorkspace(slot, workspaceId));
    return previousSlots;
  };
}

function buildWorkspaceHeaderLiveSlotsSignature(
  sessionSlots: Record<string, SessionSlot>,
  workspaceId: string,
): string {
  let signature = "";
  for (const slot of Object.values(sessionSlots)) {
    if (!sessionSlotBelongsToWorkspace(slot, workspaceId)) {
      continue;
    }
    signature += buildHeaderSlotSignature(slot);
    signature += "\u001e";
  }
  return signature;
}

function buildHeaderSlotSignature(slot: SessionSlot): string {
  return [
    slot.sessionId,
    slot.workspaceId ?? "",
    slot.agentKind,
    slot.title ?? "",
    slot.status ?? "",
    slot.executionSummary?.phase ?? "",
    pendingInteractionSignature(slot.executionSummary?.pendingInteractions),
    slot.streamConnectionState,
    slot.transcript.isStreaming ? "streaming" : "idle",
    slot.transcript.sessionMeta.title ?? "",
    pendingInteractionSignature(slot.transcript.pendingInteractions),
    slot.actionCapabilities.fork ? "fork" : "no-fork",
  ].join("\u001f");
}

function shouldWriteStringArrayPreference(
  record: Record<string, string[]>,
  key: string,
  value: readonly string[],
): boolean {
  const hasCurrent = Object.prototype.hasOwnProperty.call(record, key);
  return !hasCurrent || !sameStringArray(record[key] ?? [], value);
}

function shouldWriteReferencePreference<T>(
  record: Record<string, T>,
  key: string,
  value: T,
): boolean {
  return !Object.prototype.hasOwnProperty.call(record, key) || record[key] !== value;
}

function pendingInteractionSignature(
  interactions: readonly HeaderPendingInteraction[] | null | undefined,
): string {
  if (!interactions || interactions.length === 0) {
    return "";
  }
  return interactions
    .map((interaction) => [
      interaction.requestId ?? "",
      interaction.linkedPlanId ?? "",
      interaction.source?.linkedPlanId ?? "",
    ].join(":"))
    .join(",");
}

interface HeaderPendingInteraction {
  requestId?: string;
  linkedPlanId?: string | null;
  source?: {
    linkedPlanId?: string | null;
  } | null;
}
