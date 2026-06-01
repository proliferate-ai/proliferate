import { useEffect, useMemo, useRef } from "react";
import { useWorkspaceSessionsQuery } from "@anyharness/sdk-react";
import { useWorkspaceHeaderSubagentHierarchy } from "@/hooks/workspaces/derived/tabs/use-workspace-header-subagent-hierarchy";
import {
  buildHeaderLiveVisibilityCandidates,
  buildKnownHeaderSessions,
  collectHierarchyChildren,
  type KnownHeaderSession,
} from "@/lib/domain/workspaces/tabs/workspace-header-tabs-model-helpers";
import {
  buildHeaderDisplayShellRows,
  buildHeaderChatTabs,
  buildHeaderClosedChatTabs,
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
  type DisplayManualChatGroup,
} from "@/lib/domain/workspaces/tabs/manual-groups";
import {
  includeVisibleLinkedChildSessionIds,
  resolveVisibleChatSessionIds,
  type ChatVisibilityCandidate,
  uniqueIds,
} from "@/lib/domain/workspaces/tabs/visibility";
import {
  useWorkspaceShellTabsState,
} from "@/hooks/workspaces/ui/tabs/use-workspace-shell-tabs-state";
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
  sameStringArray,
} from "@/lib/domain/workspaces/selection/workspace-keyed-preferences";
import { measureDebugComputation } from "@/lib/infra/measurement/debug-measurement";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import { useWorkspaceHeaderTabsPreferenceEffects } from "@/hooks/workspaces/lifecycle/use-workspace-header-tabs-preference-effects";
import { buildPendingWorkspaceUiKey } from "@/lib/domain/workspaces/creation/pending-entry";
import {
  shouldUseLocalRuntimeWorkspaceSessionsQuery,
} from "@/lib/domain/workspaces/tabs/workspace-session-query-target";

const EMPTY_OPEN_TARGETS: ViewerTarget[] = [];
const EMPTY_SESSION_ID_LIST: string[] = [];
const EMPTY_MANUAL_GROUPS: DisplayManualChatGroup[] = [];

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
  const pendingWorkspaceEntry = useSessionSelectionStore((s) => s.pendingWorkspaceEntry);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (s) => s.selectedLogicalWorkspaceId,
  );
  const selectedIdentity = resolveSelectedWorkspaceIdentity({
    selectedLogicalWorkspaceId,
    materializedWorkspaceId: selectedWorkspaceId,
  });
  const { workspaceUiKey, materializedWorkspaceId } = selectedIdentity;
  const activeSessionId = useSessionSelectionStore((s) => s.activeSessionId);
  const pendingWorkspaceUiKey = pendingWorkspaceEntry
    ? buildPendingWorkspaceUiKey(pendingWorkspaceEntry)
    : null;
  const activeSessionWorkspaceId = useSessionDirectoryStore((state) =>
    activeSessionId ? state.entriesById[activeSessionId]?.workspaceId ?? null : null
  );
  const resolvedSessionWorkspaceId = materializedWorkspaceId ?? workspaceUiKey;
  const sessionWorkspaceId =
    pendingWorkspaceUiKey && activeSessionWorkspaceId === pendingWorkspaceUiKey
      ? pendingWorkspaceUiKey
      : resolvedSessionWorkspaceId;
  const isViewerStoreCurrent = Boolean(
    materializedWorkspaceId
      && viewerStoreMaterializedWorkspaceId === materializedWorkspaceId,
  );
  const openTargets = isViewerStoreCurrent ? rawOpenTargets : EMPTY_OPEN_TARGETS;
  const buffersByPath = isViewerStoreCurrent ? rawBuffersByPath : EMPTY_BUFFERS_BY_PATH;
  const tabModes = isViewerStoreCurrent ? rawTabModes : EMPTY_TAB_MODES;
  const hotPaintPending = useIsHotPaintGatePendingForWorkspace(selectedWorkspaceId);
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
  const sessionLastInteracted = useWorkspaceUiStore((s) => s.sessionLastInteracted);
  const sessionLastViewedAt = useWorkspaceUiStore((s) => s.sessionLastViewedAt);

  const workspaceSessionsQuery = useWorkspaceSessionsQuery({
    workspaceId: selectedWorkspaceId,
    enabled: shouldUseLocalRuntimeWorkspaceSessionsQuery({
      workspaceId: selectedWorkspaceId,
      hotPaintPending,
    }),
  });
  const workspaceSessionsLoaded = workspaceSessionsQuery.data !== undefined;

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
  const recentlyHiddenIds = recentlyHiddenFallback.value ?? EMPTY_SESSION_ID_LIST;
  const collapsedParentIds = collapsedParentFallback.value ?? EMPTY_SESSION_ID_LIST;
  const persistedManualGroups = manualGroupsFallback.value ?? EMPTY_MANUAL_GROUPS;
  const optimisticHeaderSessionIds = useStableStringArray(useMemo(
    () => workspaceSessionsLoaded
      ? EMPTY_SESSION_ID_LIST
      : uniqueIds([
        ...(persistedVisibleIds ?? []),
        activeSessionId ?? "",
      ]).filter(Boolean),
    [
      activeSessionId,
      persistedVisibleIds,
      workspaceSessionsLoaded,
    ],
  ));

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
  const hierarchyPrioritySessionIds = useStableStringArray(useMemo(
    () => uniqueIds([
      activeSessionId ?? "",
      ...(persistedVisibleIds ?? []),
    ]).filter(Boolean),
    [activeSessionId, persistedVisibleIds],
  ));
  const hierarchy = useWorkspaceHeaderSubagentHierarchy({
    prioritySessionIds: hierarchyPrioritySessionIds,
    workspaceId: selectedWorkspaceId,
    sessionIds: knownSessionIds,
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
  const liveChatSessionIds = useStableStringArray(useMemo(
    () => liveVisibilityCandidates.map((candidate) => candidate.sessionId),
    [liveVisibilityCandidates],
  ));
  const persistedVisibleIdsForResolution = useMemo(
    () => persistedVisibleIds?.filter((sessionId) =>
      sessionId === activeSessionId || !hierarchyChildren.rowsBySessionId.has(sessionId)
    ),
    [activeSessionId, hierarchyChildren.rowsBySessionId, persistedVisibleIds],
  );

  const visibleResolution = useMemo(
    () => resolveVisibleChatSessionIds({
      includeUnresolvedPersistedIds: !workspaceSessionsLoaded,
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
      workspaceSessionsLoaded,
    ],
  );
  const visibleChatSessionIds = useStableStringArray(visibleResolution.visibleSessionIds);
  const stripVisibleChatSessionIds = useStableStringArray(useMemo(
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
  ));
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

  useEffect(() => {
    if (!pendingWorkspaceEntry) {
      return;
    }
    logLatency("workspace.pending_shell.header_tabs_state", {
      attemptId: pendingWorkspaceEntry.attemptId,
      selectedWorkspaceId,
      selectedLogicalWorkspaceId,
      workspaceUiKey,
      materializedWorkspaceId,
      sessionWorkspaceId,
      resolvedSessionWorkspaceId,
      pendingWorkspaceUiKey,
      activeSessionWorkspaceId,
      activeSessionId,
      liveSlotIds: liveSlots.map((slot) => slot.sessionId),
      knownSessionIds,
      visibleChatSessionIds,
      stripVisibleChatSessionIds,
      orderedShellTabKeys,
      activeShellTabKey,
      shellRowsCount: displayShellRows.length,
      closedChatTabsCount: closedChatTabs.length,
      workspaceSessionsLoaded,
      activationRenderSurface: activation.renderSurface,
      storedActiveShellTabKey:
        workspaceUiKey
          ? useWorkspaceUiStore.getState().activeShellTabKeyByWorkspace[workspaceUiKey] ?? null
          : null,
      storedShellTabOrder:
        workspaceUiKey
          ? useWorkspaceUiStore.getState().shellTabOrderByWorkspace[workspaceUiKey] ?? []
          : [],
    });
  }, [
    activeSessionId,
    activeShellTabKey,
    activeSessionWorkspaceId,
    activation.renderSurface,
    displayShellRows.length,
    closedChatTabs.length,
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
  ]);

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

function useStableStringArray<T extends readonly string[]>(value: T): T {
  const previousRef = useRef<T | null>(null);
  const previous = previousRef.current;
  if (previous && sameStringArray(previous, value)) {
    return previous;
  }
  previousRef.current = value;
  return value;
}
