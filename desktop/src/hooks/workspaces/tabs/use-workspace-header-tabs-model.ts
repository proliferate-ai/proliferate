import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Session } from "@anyharness/sdk";
import { useWorkspaceSessionsQuery } from "@anyharness/sdk-react";
import { getProviderDisplayName } from "@/lib/domain/agents/provider-display";
import {
  useWorkspaceHeaderSubagentHierarchy,
  type HeaderSubagentChildRow,
} from "@/hooks/workspaces/tabs/use-workspace-header-subagent-hierarchy";
import { buildGroupedChatTabs, type GroupedChatTab } from "@/lib/domain/workspaces/tabs/grouping";
import { buildHeaderStripRows, type HeaderStripRow } from "@/lib/domain/workspaces/tabs/group-rows";
import {
  deriveManualChatGroupsForDisplay,
  resolveManualChatGroupColor,
  type ManualChatGroupId,
} from "@/lib/domain/workspaces/tabs/manual-groups";
import {
  includeVisibleLinkedChildSessionIds,
  resolveVisibleChatSessionIds,
  type ChatVisibilityCandidate,
} from "@/lib/domain/workspaces/tabs/visibility";
import {
  resolveSessionViewState,
  type SessionViewState,
} from "@/lib/domain/sessions/activity";
import { getEffectiveSessionTitle } from "@/lib/domain/sessions/title";
import { useWorkspaceActiveChatTabId } from "@/hooks/workspaces/tabs/use-workspace-shell-tabs-state";
import type { ViewerTarget } from "@/lib/domain/workspaces/viewer-target";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useIsHotPaintGatePendingForWorkspace } from "@/hooks/workspaces/use-hot-paint-gate";
import {
  activitySnapshotFromDirectoryEntry,
  useSessionDirectoryStore,
} from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import type { SessionDirectoryEntry } from "@/stores/sessions/session-types";
import { resolveSelectedWorkspaceIdentity } from "@/lib/domain/workspaces/workspace-ui-key";
import { resolveWithWorkspaceFallback } from "@/lib/domain/workspaces/workspace-keyed-preferences";

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

const EMPTY_OPEN_TARGETS: ViewerTarget[] = [];
const EMPTY_LIVE_SLOTS: SessionDirectoryEntry[] = [];

export function useWorkspaceHeaderTabsModel() {
  const rawOpenTargets = useWorkspaceViewerTabsStore((s) => s.openTargets);
  const viewerStoreMaterializedWorkspaceId = useWorkspaceViewerTabsStore(
    (s) => s.materializedWorkspaceId,
  );
  const selectedWorkspaceId = useSessionSelectionStore((s) => s.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (s) => s.selectedLogicalWorkspaceId,
  );
  const { workspaceUiKey, materializedWorkspaceId } = resolveSelectedWorkspaceIdentity({
    selectedLogicalWorkspaceId,
    materializedWorkspaceId: selectedWorkspaceId,
  });
  const sessionWorkspaceId = materializedWorkspaceId ?? workspaceUiKey;
  const openTargets = materializedWorkspaceId
    && viewerStoreMaterializedWorkspaceId === materializedWorkspaceId
    ? rawOpenTargets
    : EMPTY_OPEN_TARGETS;
  const hotPaintPending = useIsHotPaintGatePendingForWorkspace(selectedWorkspaceId);
  const activeSessionId = useSessionSelectionStore((s) => s.activeSessionId);
  const liveSlots = useSessionDirectoryStore(useShallow((state) => {
    if (!sessionWorkspaceId) {
      return EMPTY_LIVE_SLOTS;
    }
    const sessionIds = state.sessionIdsByWorkspaceId[sessionWorkspaceId] ?? [];
    return sessionIds
      .map((sessionId) => state.entriesById[sessionId])
      .filter((entry): entry is SessionDirectoryEntry => !!entry);
  }));
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

  const knownSessions = useMemo<Map<string, KnownSession>>(() => {
    const map = new Map<string, KnownSession>();
    for (const session of workspaceSessionsQuery.data ?? []) {
      if (session.dismissedAt) continue;
      if (!selectedWorkspaceId || session.workspaceId !== selectedWorkspaceId) continue;
      const clientSessionId = clientSessionIdByMaterializedSessionId[session.id] ?? session.id;
      map.set(clientSessionId, { kind: "session", session, clientSessionId });
    }
    for (const slot of liveSlots) {
      map.set(slot.sessionId, { kind: "slot", slot });
    }
    return map;
  }, [
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
  const persistedVisibleIds = resolveWithWorkspaceFallback(
    visibleByWorkspace,
    workspaceUiKey,
    materializedWorkspaceId,
  ).value;
  const recentlyHiddenIds = resolveWithWorkspaceFallback(
    hiddenByWorkspace,
    workspaceUiKey,
    materializedWorkspaceId,
  ).value ?? [];
  const collapsedParentIds = resolveWithWorkspaceFallback(
    collapsedGroupsByWorkspace,
    workspaceUiKey,
    materializedWorkspaceId,
  ).value ?? [];
  const persistedManualGroups = resolveWithWorkspaceFallback(
    manualGroupsByWorkspace,
    workspaceUiKey,
    materializedWorkspaceId,
  ).value ?? [];
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
          isActive: id === activeChatSessionIdForTabs,
          isVisible: visibleChatSessionIds.includes(id),
        };
      }),
    [
      activeChatSessionIdForTabs,
      hierarchy.childToParent,
      knownSessions,
      visibleChatSessionIds,
    ],
  );

  return {
    activeSessionId,
    selectedWorkspaceId,
    workspaceUiKey,
    materializedWorkspaceId,
    openTargets,
    chatTabs,
    stripRows,
    stripChatSessionIds,
    stripVisibleChatSessionIds,
    menuChatTabs,
    visibleChatSessionIds,
    liveChatSessionIds,
    childToParent: hierarchy.childToParent,
    childrenByParentSessionId: hierarchy.childrenByParentSessionId,
    hierarchyResolvedSessionIds: hierarchy.resolvedSessionIds,
    hierarchyChildIdsByParentSessionId: hierarchyChildren.childIdsByParentSessionId,
    displayManualGroups,
    persistedVisibleIds,
    recentlyHiddenIds,
    collapsedParentIds,
    persistedManualGroups,
    visibleResolution,
    knownSessionIds,
    workspaceSessionsLoaded: workspaceSessionsQuery.data !== undefined,
  };
}

type KnownSession =
  | { kind: "slot"; slot: SessionDirectoryEntry }
  | { kind: "session"; session: Session; clientSessionId: string };

function collectHierarchyChildren(
  childrenByParentSessionId: ReadonlyMap<string, readonly HeaderSubagentChildRow[]>,
): {
  rowsBySessionId: Map<string, HeaderSubagentChildRow>;
  childIdsByParentSessionId: Map<string, string[]>;
  visibilityCandidates: ChatVisibilityCandidate[];
} {
  const rowsBySessionId = new Map<string, HeaderSubagentChildRow>();
  const childIdsByParentSessionId = new Map<string, string[]>();
  const visibilityCandidates: ChatVisibilityCandidate[] = [];
  for (const [parentSessionId, children] of childrenByParentSessionId) {
    for (const child of children) {
      rowsBySessionId.set(child.sessionId, child);
      const childIds = childIdsByParentSessionId.get(parentSessionId) ?? [];
      childIds.push(child.sessionId);
      childIdsByParentSessionId.set(parentSessionId, childIds);
      visibilityCandidates.push({
        sessionId: child.sessionId,
        parentSessionId,
      });
    }
  }
  return { rowsBySessionId, childIdsByParentSessionId, visibilityCandidates };
}

function getKnownSessionId(known: KnownSession): string {
  return known.kind === "slot" ? known.slot.sessionId : known.clientSessionId;
}

function getKnownSessionAgentKind(known: KnownSession): string {
  return known.kind === "slot" ? known.slot.agentKind : known.session.agentKind;
}

function getKnownSessionTitle(known: KnownSession): string {
  if (known.kind === "slot") {
    return getEffectiveSessionTitle(known.slot)
      ?? getProviderDisplayName(known.slot.agentKind);
  }
  return known.session.title?.trim()
    || getProviderDisplayName(known.session.agentKind);
}

function getKnownSessionViewState(known: KnownSession): SessionViewState {
  if (known.kind === "slot") {
    return resolveSessionViewState(activitySnapshotFromDirectoryEntry(known.slot));
  }
  return resolveSessionViewState({
    status: known.session.status,
    executionSummary: known.session.executionSummary ?? null,
    streamConnectionState: "disconnected",
    transcript: { isStreaming: false, pendingInteractions: [] },
  });
}

function getLinkedChildViewState(child: HeaderSubagentChildRow): SessionViewState {
  switch (child.statusLabel) {
    case "Starting":
    case "Working":
      return "working";
    case "Failed":
    case "Timed out":
      return "errored";
    case "Closed":
      return "closed";
    case "Cancelled":
    case "Done":
    case "Idle":
    default:
      return "idle";
  }
}
