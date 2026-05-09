import type { HeaderSubagentChildRow } from "@/hooks/workspaces/tabs/use-workspace-header-subagent-hierarchy";
import {
  getKnownSessionAgentKind,
  getKnownSessionCanFork,
  getKnownSessionId,
  getKnownSessionTitle,
  getKnownSessionViewState,
  getLinkedChildViewState,
  type KnownHeaderSession,
} from "@/hooks/workspaces/tabs/workspace-header-tabs-model-helpers";
import {
  resolveManualChatGroupColor,
  type DisplayManualChatGroup,
} from "@/lib/domain/workspaces/tabs/manual-groups";
import { parseWorkspaceShellTabKey } from "@/lib/domain/workspaces/tabs/shell-tabs";
import type {
  HeaderChatMenuEntry,
  HeaderChatTabEntry,
} from "@/hooks/workspaces/tabs/workspace-header-tabs-view-model-types";
import type { GroupedChatTab } from "@/lib/domain/workspaces/tabs/grouping";

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
  activeChatSessionIdForTabs: string | null;
  groupedTabs: readonly GroupedChatTab[];
  rowsBySessionId: ReadonlyMap<string, HeaderSubagentChildRow>;
  childrenByParentSessionId: ReadonlyMap<string, readonly HeaderSubagentChildRow[]>;
  resolvedSessionIds: ReadonlySet<string>;
  knownSessions: ReadonlyMap<string, KnownHeaderSession>;
  manualGroupByTopLevelSessionId: ReadonlyMap<string, DisplayManualChatGroup>;
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
        isActive: grouped.sessionId === args.activeChatSessionIdForTabs,
        groupColor,
        visualGroupId: manualGroup?.id ?? (isSubagentGrouped ? grouped.groupRootSessionId : null),
        manualGroupId: manualGroup?.id ?? null,
        isHierarchyResolved: args.resolvedSessionIds.has(grouped.sessionId),
      } satisfies HeaderChatTabEntry;
    })
    .filter((tab): tab is HeaderChatTabEntry => !!tab);
}

export function resolveHighlightedChatSessionId(
  highlightedTabKey: string | null | undefined,
): string | null {
  const highlighted = highlightedTabKey ? parseWorkspaceShellTabKey(highlightedTabKey) : null;
  return highlighted?.kind === "chat" ? highlighted.sessionId : null;
}

export function buildHeaderMenuChatTabs(args: {
  highlightedChatSessionId: string | null;
  childToParent: ReadonlyMap<string, string>;
  knownSessions: Iterable<KnownHeaderSession>;
  visibleChatSessionIds: readonly string[];
}): HeaderChatMenuEntry[] {
  return Array.from(args.knownSessions)
    .filter((known) => !args.childToParent.has(getKnownSessionId(known)))
    .map((known) => {
      const id = getKnownSessionId(known);
      return {
        id,
        title: getKnownSessionTitle(known),
        agentKind: getKnownSessionAgentKind(known),
        viewState: getKnownSessionViewState(known),
        isActive: id === args.highlightedChatSessionId,
        isVisible: args.visibleChatSessionIds.includes(id),
      };
    });
}
