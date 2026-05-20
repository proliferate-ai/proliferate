import {
  getKnownSessionAgentKind,
  getKnownSessionCanFork,
  getKnownSessionId,
  getKnownSessionTitle,
  getKnownSessionViewState,
  getLinkedChildViewState,
  type HeaderHierarchyChildRow,
  type KnownHeaderSession,
} from "@/lib/domain/workspaces/tabs/workspace-header-tabs-model-helpers";
import {
  resolveManualChatGroupColor,
  type DisplayManualChatGroup,
} from "@/lib/domain/workspaces/tabs/manual-groups";
import { parseWorkspaceShellTabKey } from "@/lib/domain/workspaces/tabs/shell-tabs";
import type {
  HeaderChatMenuEntry,
  HeaderChatStripRow,
  HeaderChatTabEntry,
  HeaderWorkspaceShellStripRow,
} from "@/lib/domain/workspaces/tabs/workspace-header-tabs-view-model-types";
import type { GroupedChatTab } from "@/lib/domain/workspaces/tabs/grouping";
import { buildDelegatedWorkTabIdentity } from "@/lib/domain/delegated-work/presentation";

export function buildManualGroupByTopLevelSessionId(
  displayManualGroups: readonly DisplayManualChatGroup[],
): Map<string, DisplayManualChatGroup> {
  const map = new Map<string, DisplayManualChatGroup>();
  for (const group of displayManualGroups) {
    for (const sessionId of group.sessionIds) {
      map.set(sessionId, group);
    }
  }
  return map;
}

export function buildHeaderChatTabs(args: {
  groupedTabs: readonly GroupedChatTab[];
  rowsBySessionId: ReadonlyMap<string, HeaderHierarchyChildRow>;
  childrenByParentSessionId: ReadonlyMap<string, readonly HeaderHierarchyChildRow[]>;
  resolvedSessionIds: ReadonlySet<string>;
  knownSessions: ReadonlyMap<string, KnownHeaderSession>;
  manualGroupByTopLevelSessionId: ReadonlyMap<string, DisplayManualChatGroup>;
  sessionLastInteracted?: Readonly<Record<string, string>>;
  sessionLastViewedAt?: Readonly<Record<string, string>>;
}): HeaderChatTabEntry[] {
  return args.groupedTabs
    .map((grouped) => {
      const known = args.knownSessions.get(grouped.sessionId);
      const hierarchyChild = args.rowsBySessionId.get(grouped.sessionId);
      if (!known && !hierarchyChild) {
        return null;
      }
      const manualGroup = args.manualGroupByTopLevelSessionId.get(
        grouped.isChild ? grouped.groupRootSessionId : grouped.sessionId,
      ) ?? null;
      const parentKnown = hierarchyChild
        ? args.knownSessions.get(hierarchyChild.parentSessionId)
        : undefined;
      const isSubagentGrouped =
        grouped.isChild || args.childrenByParentSessionId.has(grouped.sessionId);
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
        source: hierarchyChild?.source ?? null,
        sessionLinkId: hierarchyChild?.sessionLinkId ?? null,
        workspaceId: hierarchyChild?.workspaceId ?? null,
        isActive: false as boolean,
        hasUnreadActivity: hasUnreadSessionActivity({
          sessionId: grouped.sessionId,
          sessionLastInteracted: args.sessionLastInteracted,
          sessionLastViewedAt: args.sessionLastViewedAt,
        }),
        groupColor,
        visualGroupId: manualGroup?.id ?? (isSubagentGrouped ? grouped.groupRootSessionId : null),
        manualGroupId: manualGroup?.id ?? null,
        isHierarchyResolved: args.resolvedSessionIds.has(grouped.sessionId),
        isResolvingSession: known?.kind === "placeholder",
        delegatedAgent: hierarchyChild
          ? buildDelegatedWorkTabIdentity({
            id: hierarchyChild.sessionLinkId || hierarchyChild.sessionId,
            title: hierarchyChild.title,
            source: hierarchyChild.source,
            reviewKind: hierarchyChild.reviewKind,
            statusLabel: hierarchyChild.statusLabel,
            wakeScheduled: hierarchyChild.wakeScheduled,
            workspaceId: hierarchyChild.workspaceId ?? null,
            sessionId: hierarchyChild.sessionId,
            sessionLinkId: hierarchyChild.sessionLinkId,
            parentTitle: parentKnown ? getKnownSessionTitle(parentKnown) : null,
          })
          : null,
      } satisfies HeaderChatTabEntry;
    })
    .filter((tab): tab is HeaderChatTabEntry => !!tab);
}

export function selectHeaderStripChatSessionIds(
  stripRows: readonly HeaderChatStripRow[],
): string[] {
  return stripRows
    .filter((row): row is Extract<HeaderChatStripRow, { kind: "tab" }> => row.kind === "tab")
    .filter((row) => !row.tab.isReviewAgentChild)
    .map((row) => row.tab.sessionId);
}

export function resolveHighlightedChatSessionId(
  highlightedTabKey: string | null | undefined,
): string | null {
  const highlighted = highlightedTabKey ? parseWorkspaceShellTabKey(highlightedTabKey) : null;
  return highlighted?.kind === "chat" ? highlighted.sessionId : null;
}

export function buildHeaderClosedChatTabs(args: {
  highlightedChatSessionId: string | null;
  rowsBySessionId: ReadonlyMap<string, HeaderHierarchyChildRow>;
  knownSessions: Iterable<KnownHeaderSession>;
  visibleChatSessionIds: readonly string[];
  recentlyHiddenIds: readonly string[];
  sessionLastInteracted?: Readonly<Record<string, string>>;
  sessionLastViewedAt?: Readonly<Record<string, string>>;
}): HeaderChatMenuEntry[] {
  const knownById = new Map<string, KnownHeaderSession>();
  for (const known of args.knownSessions) {
    knownById.set(getKnownSessionId(known), known);
  }

  const visibleSet = new Set(args.visibleChatSessionIds);
  const seen = new Set<string>();
  const rows: HeaderChatMenuEntry[] = [];
  for (const id of args.recentlyHiddenIds) {
    if (
      seen.has(id)
      || visibleSet.has(id)
    ) {
      continue;
    }
    seen.add(id);
    const hierarchyChild = args.rowsBySessionId.get(id);
    if (hierarchyChild) {
      rows.push({
        id,
        title: hierarchyChild.title,
        agentKind: hierarchyChild.agentKind,
        viewState: getLinkedChildViewState(hierarchyChild),
        isResolvingSession: false,
        hasUnreadActivity: hasUnreadSessionActivity({
          sessionId: id,
          sessionLastInteracted: args.sessionLastInteracted,
          sessionLastViewedAt: args.sessionLastViewedAt,
        }),
        isActive: id === args.highlightedChatSessionId,
        isVisible: false,
      });
      continue;
    }
    const known = knownById.get(id);
    if (!known) {
      continue;
    }
    rows.push({
      id,
      title: getKnownSessionTitle(known),
      agentKind: getKnownSessionAgentKind(known),
      viewState: getKnownSessionViewState(known),
      isResolvingSession: known.kind === "placeholder",
      hasUnreadActivity: hasUnreadSessionActivity({
        sessionId: id,
        sessionLastInteracted: args.sessionLastInteracted,
        sessionLastViewedAt: args.sessionLastViewedAt,
      }),
      isActive: id === args.highlightedChatSessionId,
      isVisible: false,
    });
  }
  return rows;
}

export function buildHeaderDisplayShellRows(args: {
  highlightedChatSessionId: string | null;
  shellRows: readonly HeaderWorkspaceShellStripRow[];
}): HeaderWorkspaceShellStripRow[] {
  return args.shellRows.map((shellRow) => {
    if (shellRow.kind !== "chat" || shellRow.row.kind !== "tab") {
      return shellRow;
    }
    return {
      ...shellRow,
      row: {
        ...shellRow.row,
        tab: {
          ...shellRow.row.tab,
          isActive: shellRow.row.tab.sessionId === args.highlightedChatSessionId,
          hasUnreadActivity: shellRow.row.tab.sessionId === args.highlightedChatSessionId
            ? false
            : shellRow.row.tab.hasUnreadActivity,
        },
      },
    };
  });
}

export function hasUnreadSessionActivity({
  sessionId,
  sessionLastInteracted,
  sessionLastViewedAt,
}: {
  sessionId: string;
  sessionLastInteracted?: Readonly<Record<string, string>>;
  sessionLastViewedAt?: Readonly<Record<string, string>>;
}): boolean {
  const lastInteracted = sessionLastInteracted?.[sessionId];
  if (!lastInteracted) {
    return false;
  }
  const lastViewed = sessionLastViewedAt?.[sessionId];
  return !lastViewed
    || new Date(lastInteracted).getTime() > new Date(lastViewed).getTime();
}
