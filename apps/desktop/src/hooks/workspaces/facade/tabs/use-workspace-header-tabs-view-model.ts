import { useMemo } from "react";
import { useWorkspaceSessionsQuery } from "@anyharness/sdk-react";
import { useWorkspaceHeaderSubagentHierarchy } from "@/hooks/workspaces/cache/tabs/use-workspace-header-subagent-hierarchy";
import {
  buildKnownHeaderSessions,
  type KnownHeaderSession,
} from "@/lib/domain/workspaces/tabs/workspace-header-tabs-model-helpers";
import {
  buildHeaderDisplayShellRows,
  buildHeaderChatTabs,
  buildHeaderClosedChatTabs,
  resolveHighlightedChatSessionId,
  selectHeaderStripChatSessionIds,
} from "@/lib/domain/workspaces/tabs/workspace-header-tabs-view-model-derivation";
import { createWorkspaceHeaderLiveSlotsSelector } from "@/lib/domain/workspaces/tabs/workspace-header-live-slots-selector";
import type {
  HeaderChatMenuEntry,
  HeaderChatTabEntry,
  HeaderWorkspaceShellStripRow,
} from "@/lib/domain/workspaces/tabs/workspace-header-tabs-view-model-types";
import { buildHeaderStripRows } from "@/lib/domain/workspaces/tabs/group-rows";
import {
  resolveManualChatGroupColor,
} from "@/lib/domain/workspaces/tabs/manual-groups";
import {
  useWorkspaceShellTabsState,
} from "@/hooks/workspaces/ui/tabs/use-workspace-shell-tabs-state";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { measureDebugComputation } from "@/lib/infra/measurement/debug-measurement";
import { useWorkspaceHeaderTabsPreferenceEffects } from "@/hooks/workspaces/lifecycle/use-workspace-header-tabs-preference-effects";
import {
  shouldUseLocalRuntimeWorkspaceSessionsQuery,
} from "@/lib/domain/workspaces/tabs/workspace-session-query-target";
import { useStableStringArray } from "@/hooks/workspaces/facade/tabs/use-stable-string-array";
import { useWorkspaceHeaderTabsWorkspaceState } from "@/hooks/workspaces/facade/tabs/use-workspace-header-tabs-workspace-state";
import { useWorkspaceHeaderTabsDebugLogging } from "@/hooks/workspaces/lifecycle/use-workspace-header-tabs-debug-logging";
import { useWorkspaceHeaderTabsPreferences } from "@/hooks/workspaces/facade/tabs/use-workspace-header-tabs-preferences";
import { useWorkspaceHeaderTabsVisibility } from "@/hooks/workspaces/facade/tabs/use-workspace-header-tabs-visibility";

export function useWorkspaceHeaderTabsViewModel() {
  const {
    activeSessionId,
    activeSessionWorkspaceId,
    buffersByPath,
    hotPaintPending,
    materializedWorkspaceId,
    openTargets,
    pendingWorkspaceEntry,
    pendingWorkspaceUiKey,
    resolvedSessionWorkspaceId,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
    sessionWorkspaceId,
    tabModes,
    workspaceUiKey,
  } = useWorkspaceHeaderTabsWorkspaceState();
  const liveSlotsSelector = useMemo(
    () => createWorkspaceHeaderLiveSlotsSelector(sessionWorkspaceId),
    [sessionWorkspaceId],
  );
  const liveSlots = useSessionDirectoryStore(liveSlotsSelector);
  const clientSessionIdByMaterializedSessionId = useSessionDirectoryStore(
    (state) => state.clientSessionIdByMaterializedSessionId,
  );

  const workspaceSessionsQuery = useWorkspaceSessionsQuery({
    workspaceId: selectedWorkspaceId,
    enabled: shouldUseLocalRuntimeWorkspaceSessionsQuery({
      workspaceId: selectedWorkspaceId,
      hotPaintPending,
    }),
  });
  const workspaceSessionsLoaded = workspaceSessionsQuery.data !== undefined;

  const {
    collapsedParentFallback,
    collapsedParentIds,
    hierarchyPrioritySessionIds,
    manualGroupsFallback,
    optimisticHeaderSessionIds,
    persistedManualGroups,
    persistedVisibleFallback,
    persistedVisibleIds,
    recentlyHiddenFallback,
    recentlyHiddenIds,
    sessionLastInteracted,
    sessionLastViewedAt,
  } = useWorkspaceHeaderTabsPreferences({
    activeSessionId,
    materializedWorkspaceId,
    workspaceSessionsLoaded,
    workspaceUiKey,
  });

  const knownSessions = useMemo<Map<string, KnownHeaderSession>>(() =>
    measureDebugComputation({
      category: "header_tabs.derive",
      label: "known_sessions",
      keys: [
        "liveSlots",
        "optimisticHeaderSessionIds",
        "workspaceSessionsQuery.data",
        "selectedWorkspaceId",
      ],
      count: (map) => map.size,
    }, () => {
      return buildKnownHeaderSessions({
        optimisticSessionIds: optimisticHeaderSessionIds,
        sessions: workspaceSessionsQuery.data,
        selectedWorkspaceId,
        clientSessionIdByMaterializedSessionId,
        liveSlots,
      });
    }), [
      clientSessionIdByMaterializedSessionId,
      liveSlots,
      optimisticHeaderSessionIds,
      selectedWorkspaceId,
      workspaceSessionsQuery.data,
    ]);
  const knownSessionIds = useStableStringArray(
    useMemo(() => Array.from(knownSessions.keys()), [knownSessions]),
  );
  const hierarchy = useWorkspaceHeaderSubagentHierarchy({
    prioritySessionIds: hierarchyPrioritySessionIds,
    workspaceId: selectedWorkspaceId,
    sessionIds: knownSessionIds,
  });
  const {
    displayManualGroups,
    groupedTabs,
    hierarchyChildren,
    liveChatSessionIds,
    manualGroupByTopLevelSessionId,
    prunedRecentlyHiddenIds,
    stripVisibleChatSessionIds,
    visibleChatSessionIds,
  } = useWorkspaceHeaderTabsVisibility({
    activeSessionId,
    hierarchy,
    knownSessionIds,
    persistedManualGroups,
    persistedVisibleIds,
    recentlyHiddenIds,
    workspaceSessionsLoaded,
  });
  const chatTabs = useMemo<HeaderChatTabEntry[]>(
    () => measureDebugComputation({
      category: "header_tabs.derive",
      label: "chat_tabs",
      keys: [
        "groupedTabs",
        "hierarchy",
        "knownSessions",
        "manualGroupByTopLevelSessionId",
      ],
      count: (tabs) => tabs.length,
    }, () => buildHeaderChatTabs({
      groupedTabs,
      rowsBySessionId: hierarchyChildren.rowsBySessionId,
      childrenByParentSessionId: hierarchy.childrenByParentSessionId,
      resolvedSessionIds: hierarchy.resolvedSessionIds,
      knownSessions,
      manualGroupByTopLevelSessionId,
      sessionLastInteracted,
      sessionLastViewedAt,
    })),
    [
      groupedTabs,
      hierarchyChildren.rowsBySessionId,
      hierarchy.childrenByParentSessionId,
      hierarchy.resolvedSessionIds,
      knownSessions,
      manualGroupByTopLevelSessionId,
      sessionLastInteracted,
      sessionLastViewedAt,
    ],
  );

  const activeSessionIdForStripRows =
    collapsedParentIds.length > 0 ? activeSessionId : null;
  const stripRows = useMemo(
    () => measureDebugComputation({
      category: "header_tabs.derive",
      label: "strip_rows",
      keys: ["activeSessionIdForStripRows", "chatTabs", "collapsedParentIds", "displayManualGroups"],
      count: (rows) => rows.length,
    }, () => buildHeaderStripRows({
      groupedTabs: chatTabs,
      childrenByParentSessionId: hierarchy.childrenByParentSessionId,
      collapsedGroupIds: collapsedParentIds,
      resolveManualGroupColor: (group) => resolveManualChatGroupColor(group.colorId),
      manualGroups: displayManualGroups,
      activeSessionId: activeSessionIdForStripRows,
      subagentLabel: "Agents",
    })),
    [
      activeSessionIdForStripRows,
      chatTabs,
      collapsedParentIds,
      displayManualGroups,
      hierarchy.childrenByParentSessionId,
    ],
  );
  const stripChatSessionIds = useStableStringArray(useMemo(
    () => selectHeaderStripChatSessionIds(stripRows),
    [stripRows],
  ));
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
    stripRows,
    displayManualGroups,
    subagentChildIdsByParentId: hierarchyChildren.childIdsByParentSessionId,
  });
  const highlightedChatSessionId = useMemo(() => {
    return resolveHighlightedChatSessionId(activation.highlightedTabKey);
  }, [activation.highlightedTabKey]);
  const displayShellRows = useMemo<HeaderWorkspaceShellStripRow[]>(
    () => measureDebugComputation({
      category: "header_tabs.derive",
      label: "display_shell_rows",
      keys: ["highlightedChatSessionId", "shellRows"],
      count: (rows) => rows.length,
    }, () => buildHeaderDisplayShellRows({
      highlightedChatSessionId,
      shellRows,
    })),
    [highlightedChatSessionId, shellRows],
  );

  useWorkspaceHeaderTabsPreferenceEffects({
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
    childToParent: hierarchy.childToParent,
    childrenByParentSessionId: hierarchy.childrenByParentSessionId,
    knownSessionIds,
    resolvedHierarchySessionIds: hierarchy.resolvedSessionIds,
  });

  const closedChatTabs = useMemo<HeaderChatMenuEntry[]>(
    () => measureDebugComputation({
      category: "header_tabs.derive",
      label: "closed_chat_tabs",
      keys: [
        "highlightedChatSessionId",
        "hierarchyChildren.rowsBySessionId",
        "knownSessions",
        "recentlyHiddenIds",
        "visibleChatSessionIds",
      ],
      count: (tabs) => tabs.length,
    }, () => buildHeaderClosedChatTabs({
      highlightedChatSessionId,
      rowsBySessionId: hierarchyChildren.rowsBySessionId,
      knownSessions: knownSessions.values(),
      recentlyHiddenIds,
      visibleChatSessionIds,
      sessionLastInteracted,
      sessionLastViewedAt,
    })),
    [
      highlightedChatSessionId,
      hierarchyChildren.rowsBySessionId,
      knownSessions,
      recentlyHiddenIds,
      sessionLastInteracted,
      sessionLastViewedAt,
      visibleChatSessionIds,
    ],
  );

  useWorkspaceHeaderTabsDebugLogging({
    activationRenderSurface: activation.renderSurface,
    activeSessionId,
    activeSessionWorkspaceId,
    activeShellTabKey,
    closedChatTabsCount: closedChatTabs.length,
    displayShellRowsCount: displayShellRows.length,
    knownSessionIds,
    liveSlots,
    materializedWorkspaceId,
    orderedShellTabKeys,
    pendingWorkspaceEntry,
    pendingWorkspaceUiKey,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
    sessionWorkspaceId,
    resolvedSessionWorkspaceId,
    stripVisibleChatSessionIds,
    visibleChatSessionIds,
    workspaceSessionsLoaded,
    workspaceUiKey,
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
    closedChatTabs,
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
    closedChatTabs,
    displayManualGroups,
    hierarchy.childToParent,
    hierarchy.childrenByParentSessionId,
    hierarchy.resolvedSessionIds,
    liveChatSessionIds,
    materializedWorkspaceId,
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
