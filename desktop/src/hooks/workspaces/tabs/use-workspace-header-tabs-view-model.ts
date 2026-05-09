import { useMemo } from "react";
import { useWorkspaceSessionsQuery } from "@anyharness/sdk-react";
import { useWorkspaceHeaderSubagentHierarchy } from "@/hooks/workspaces/tabs/use-workspace-header-subagent-hierarchy";
import {
  buildHeaderLiveVisibilityCandidates,
  buildKnownHeaderSessions,
  collectHierarchyChildren,
  type KnownHeaderSession,
} from "@/lib/domain/workspaces/tabs/workspace-header-tabs-model-helpers";
import {
  buildHeaderDisplayShellRows,
  buildHeaderChatTabs,
  buildHeaderMenuChatTabs,
  buildManualGroupByTopLevelSessionId,
  resolveHighlightedChatSessionId,
  selectHeaderStripChatSessionIds,
} from "@/lib/domain/workspaces/tabs/workspace-header-tabs-view-model-derivation";
import { createWorkspaceHeaderLiveSlotsSelector } from "@/lib/domain/workspaces/tabs/workspace-header-live-slots-selector";
import type {
  HeaderChatMenuEntry,
  HeaderChatTabEntry,
  HeaderWorkspaceShellStripRow,
} from "@/lib/domain/workspaces/tabs/workspace-header-tabs-view-model-types";
import { buildGroupedChatTabs } from "@/lib/domain/workspaces/tabs/grouping";
import { buildHeaderStripRows } from "@/lib/domain/workspaces/tabs/group-rows";
import {
  resolveManualChatGroupColor,
  deriveManualChatGroupsForDisplay,
} from "@/lib/domain/workspaces/tabs/manual-groups";
import {
  includeVisibleLinkedChildSessionIds,
  resolveVisibleChatSessionIds,
  type ChatVisibilityCandidate,
} from "@/lib/domain/workspaces/tabs/visibility";
import {
  useWorkspaceActiveChatTabId,
  useWorkspaceShellTabsState,
} from "@/hooks/workspaces/tabs/use-workspace-shell-tabs-state";
import type {
  FileViewerMode,
  ViewerTarget,
} from "@/lib/domain/workspaces/viewer/viewer-target";
import {
  useWorkspaceFileBuffersStore,
  type WorkspaceFileBuffer,
} from "@/stores/editor/workspace-file-buffers-store";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useIsHotPaintGatePendingForWorkspace } from "@/hooks/workspaces/derived/use-hot-paint-gate";
import { resolveSelectedWorkspaceIdentity } from "@/lib/domain/workspaces/selection/workspace-ui-key";
import {
  resolveWithWorkspaceFallback,
} from "@/lib/domain/workspaces/selection/workspace-keyed-preferences";
import { useDebugValueChange } from "@/hooks/ui/use-debug-value-change";
import { measureDebugComputation } from "@/lib/infra/measurement/debug-measurement";
import { useWorkspaceHeaderTabsPreferenceEffects } from "@/hooks/workspaces/lifecycle/use-workspace-header-tabs-preference-effects";

const EMPTY_OPEN_TARGETS: ViewerTarget[] = [];

const EMPTY_BUFFERS_BY_PATH: Record<string, WorkspaceFileBuffer> = {};
const EMPTY_TAB_MODES: Record<string, FileViewerMode> = {};

export function useWorkspaceHeaderTabsViewModel() {
  const rawOpenTargets = useWorkspaceViewerTabsStore((s) => s.openTargets);
  const rawBuffersByPath = useWorkspaceFileBuffersStore((s) => s.buffersByPath);
  const rawTabModes = useWorkspaceViewerTabsStore((s) => s.modeByTargetKey);
  const viewerStoreMaterializedWorkspaceId = useWorkspaceViewerTabsStore(
    (s) => s.materializedWorkspaceId,
  );

  const selectedWorkspaceId = useSessionSelectionStore((s) => s.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (s) => s.selectedLogicalWorkspaceId,
  );
  const selectedIdentity = resolveSelectedWorkspaceIdentity({
    selectedLogicalWorkspaceId,
    materializedWorkspaceId: selectedWorkspaceId,
  });
  const { workspaceUiKey, materializedWorkspaceId } = selectedIdentity;
  const sessionWorkspaceId = materializedWorkspaceId ?? workspaceUiKey;
  const isViewerStoreCurrent = Boolean(
    materializedWorkspaceId
      && viewerStoreMaterializedWorkspaceId === materializedWorkspaceId,
  );
  const openTargets = isViewerStoreCurrent ? rawOpenTargets : EMPTY_OPEN_TARGETS;
  const buffersByPath = isViewerStoreCurrent ? rawBuffersByPath : EMPTY_BUFFERS_BY_PATH;
  const tabModes = isViewerStoreCurrent ? rawTabModes : EMPTY_TAB_MODES;
  const hotPaintPending = useIsHotPaintGatePendingForWorkspace(selectedWorkspaceId);
  const activeSessionId = useSessionSelectionStore((s) => s.activeSessionId);
  const liveSlotsSelector = useMemo(
    () => createWorkspaceHeaderLiveSlotsSelector(sessionWorkspaceId),
    [sessionWorkspaceId],
  );
  const liveSlots = useSessionDirectoryStore(liveSlotsSelector);
  const clientSessionIdByMaterializedSessionId = useSessionDirectoryStore(
    (state) => state.clientSessionIdByMaterializedSessionId,
  );

  const visibleByWorkspace = useWorkspaceUiStore((s) => s.visibleChatSessionIdsByWorkspace);
  const hiddenByWorkspace = useWorkspaceUiStore((s) => s.recentlyHiddenChatSessionIdsByWorkspace);
  const collapsedGroupsByWorkspace = useWorkspaceUiStore((s) => s.collapsedChatGroupsByWorkspace);
  const manualGroupsByWorkspace = useWorkspaceUiStore((s) => s.manualChatGroupsByWorkspace);

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
      return buildKnownHeaderSessions({
        sessions: workspaceSessionsQuery.data,
        selectedWorkspaceId,
        clientSessionIdByMaterializedSessionId,
        liveSlots,
      });
    }), [
      clientSessionIdByMaterializedSessionId,
      liveSlots,
      selectedWorkspaceId,
      workspaceSessionsQuery.data,
    ]);
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
    }, () => buildHeaderLiveVisibilityCandidates({
      knownSessionIds,
      childToParent: hierarchy.childToParent,
      hierarchyVisibilityCandidates: hierarchyChildren.visibilityCandidates,
    })),
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
    return buildManualGroupByTopLevelSessionId(displayManualGroups);
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
    }, () => buildHeaderChatTabs({
      activeChatSessionIdForTabs,
      groupedTabs,
      rowsBySessionId: hierarchyChildren.rowsBySessionId,
      childrenByParentSessionId: hierarchy.childrenByParentSessionId,
      resolvedSessionIds: hierarchy.resolvedSessionIds,
      knownSessions,
      manualGroupByTopLevelSessionId,
    })),
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
    () => selectHeaderStripChatSessionIds(stripRows),
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
    prunedRecentlyHiddenIds: visibleResolution.prunedRecentlyHiddenIds,
    workspaceSessionsLoaded,
    collapsedParentIds,
    persistedManualGroups,
    activeSessionId,
    childToParent: hierarchy.childToParent,
    childrenByParentSessionId: hierarchy.childrenByParentSessionId,
    knownSessionIds,
    resolvedHierarchySessionIds: hierarchy.resolvedSessionIds,
  });

  const menuChatTabs = useMemo<HeaderChatMenuEntry[]>(
    () => measureDebugComputation({
      category: "header_tabs.derive",
      label: "menu_chat_tabs",
      keys: ["highlightedChatSessionId", "hierarchy.childToParent", "knownSessions", "visibleChatSessionIds"],
      count: (tabs) => tabs.length,
    }, () => buildHeaderMenuChatTabs({
      highlightedChatSessionId,
      childToParent: hierarchy.childToParent,
      knownSessions: knownSessions.values(),
      visibleChatSessionIds,
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
