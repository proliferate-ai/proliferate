import { useMemo } from "react";
import type { Session } from "@anyharness/sdk";
import { useWorkspaceSessionsQuery } from "@anyharness/sdk-react";
import { getProviderDisplayName } from "@/config/providers";
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
  sessionSlotBelongsToWorkspace,
} from "@/lib/domain/sessions/activity";
import { getEffectiveSessionTitle } from "@/lib/domain/sessions/title";
import { resolveSubagentColor } from "@/lib/domain/chat/subagent-braille-color";
import { useWorkspaceActiveChatTabId } from "@/hooks/workspaces/tabs/use-workspace-shell-tabs-state";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useHarnessStore, type SessionSlot } from "@/stores/sessions/harness-store";
import { useIsHotPaintGatePendingForWorkspace } from "@/hooks/workspaces/use-hot-paint-gate";

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

export function useWorkspaceHeaderTabsModel() {
  const openTabs = useWorkspaceFilesStore((s) => s.openTabs);
  const selectedWorkspaceId = useHarnessStore((s) => s.selectedWorkspaceId);
  const hotPaintPending = useIsHotPaintGatePendingForWorkspace(selectedWorkspaceId);
  const activeSessionId = useHarnessStore((s) => s.activeSessionId);
  const sessionSlots = useHarnessStore((s) => s.sessionSlots);

  const visibleByWorkspace = useWorkspaceUiStore((s) => s.visibleChatSessionIdsByWorkspace);
  const hiddenByWorkspace = useWorkspaceUiStore((s) => s.recentlyHiddenChatSessionIdsByWorkspace);
  const collapsedGroupsByWorkspace = useWorkspaceUiStore((s) => s.collapsedChatGroupsByWorkspace);
  const manualGroupsByWorkspace = useWorkspaceUiStore((s) => s.manualChatGroupsByWorkspace);

  const workspaceSessionsQuery = useWorkspaceSessionsQuery({
    workspaceId: selectedWorkspaceId,
    enabled: !!selectedWorkspaceId && !hotPaintPending,
  });

  const liveSlots = useMemo(
    () => Object.values(sessionSlots)
      .filter((slot) => sessionSlotBelongsToWorkspace(slot, selectedWorkspaceId)),
    [selectedWorkspaceId, sessionSlots],
  );
  const knownSessions = useMemo<Map<string, KnownSession>>(() => {
    const map = new Map<string, KnownSession>();
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
  const persistedVisibleIds = selectedWorkspaceId
    ? visibleByWorkspace[selectedWorkspaceId]
    : undefined;
  const recentlyHiddenIds = selectedWorkspaceId
    ? hiddenByWorkspace[selectedWorkspaceId] ?? []
    : [];
  const collapsedParentIds = selectedWorkspaceId
    ? collapsedGroupsByWorkspace[selectedWorkspaceId] ?? []
    : [];
  const persistedManualGroups = selectedWorkspaceId
    ? manualGroupsByWorkspace[selectedWorkspaceId] ?? []
    : [];
  const activeChatSessionIdForTabs = useWorkspaceActiveChatTabId({
    selectedWorkspaceId,
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
        const subagentGroupColor = grouped.isChild || hierarchy.childrenByParentSessionId.has(grouped.sessionId)
          ? resolveSubagentColor(grouped.groupRootSessionId)
          : null;
        const groupColor = manualGroup
          ? resolveManualChatGroupColor(manualGroup.colorId)
          : subagentGroupColor;
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
          visualGroupId: manualGroup?.id ?? (subagentGroupColor ? grouped.groupRootSessionId : null),
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
      resolveSubagentColor,
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
    openTabs,
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
  | { kind: "slot"; slot: SessionSlot }
  | { kind: "session"; session: Session };

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
  return known.kind === "slot" ? known.slot.sessionId : known.session.id;
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
    return resolveSessionViewState(known.slot);
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
