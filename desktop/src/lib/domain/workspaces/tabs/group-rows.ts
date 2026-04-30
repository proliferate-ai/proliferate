import type { GroupedChatTab } from "./grouping";
import type { DisplayManualChatGroup, ManualChatGroupId } from "./manual-groups";

interface BasePillRow {
  kind: "pill";
  groupId: string;
  color: string;
  label: string;
  isCollapsed: boolean;
}

export interface SubagentPillRow extends BasePillRow {
  groupKind: "subagent";
  parentId: string;
}

export interface ManualPillRow extends BasePillRow {
  groupKind: "manual";
  manualGroupId: ManualChatGroupId;
}

export type PillRow = SubagentPillRow | ManualPillRow;

export interface TabRow<TTab extends GroupedChatTab = GroupedChatTab> {
  kind: "tab";
  tab: TTab;
}

export type HeaderStripRow<TTab extends GroupedChatTab = GroupedChatTab> =
  | PillRow
  | TabRow<TTab>;

export function buildHeaderStripRows<TTab extends GroupedChatTab>(args: {
  groupedTabs: TTab[];
  childrenByParentSessionId: ReadonlyMap<string, readonly unknown[]>;
  collapsedGroupIds: readonly string[] | ReadonlySet<string>;
  resolveSubagentColor: (parentId: string) => string;
  resolveManualGroupColor: (group: DisplayManualChatGroup) => string;
  manualGroups?: readonly DisplayManualChatGroup[];
  activeSessionId?: string | null;
  subagentLabel?: string;
}): HeaderStripRow<TTab>[] {
  const collapsedSet = args.collapsedGroupIds instanceof Set
    ? args.collapsedGroupIds
    : new Set(args.collapsedGroupIds);
  const tabsBySessionId = new Map(args.groupedTabs.map((tab) => [tab.sessionId, tab]));
  const childIdsByParentId = new Map<string, string[]>();
  const manualGroupBySessionId = new Map<string, DisplayManualChatGroup>();
  const emittedManualGroups = new Set<string>();
  const emittedSubagentGroups = new Set<string>();
  const rows: HeaderStripRow<TTab>[] = [];
  const subagentLabel = args.subagentLabel ?? "Agents";

  for (const tab of args.groupedTabs) {
    if (!tab.isChild) {
      continue;
    }
    const current = childIdsByParentId.get(tab.groupRootSessionId) ?? [];
    current.push(tab.sessionId);
    childIdsByParentId.set(tab.groupRootSessionId, current);
  }

  for (const group of args.manualGroups ?? []) {
    for (const sessionId of group.sessionIds) {
      manualGroupBySessionId.set(sessionId, group);
    }
  }

  function pushTab(sessionId: string) {
    const tab = tabsBySessionId.get(sessionId);
    if (tab) {
      rows.push({ kind: "tab", tab });
    }
  }

  function pushTopLevelWithChildren(parentId: string) {
    pushTab(parentId);
    if (isSubagentGroupCollapsed(parentId)) {
      return;
    }
    for (const childId of childIdsByParentId.get(parentId) ?? []) {
      pushTab(childId);
    }
  }

  function emitManualGroup(group: DisplayManualChatGroup) {
    if (emittedManualGroups.has(group.id)) {
      return;
    }
    emittedManualGroups.add(group.id);
    const isCollapsed = isManualGroupCollapsed(group);
    rows.push({
      kind: "pill",
      groupKind: "manual",
      groupId: group.id,
      manualGroupId: group.id,
      color: args.resolveManualGroupColor(group),
      label: group.label,
      isCollapsed,
    });
    if (isCollapsed) {
      return;
    }
    for (const sessionId of group.sessionIds) {
      pushTopLevelWithChildren(sessionId);
    }
  }

  function emitSubagentGroup(parentId: string) {
    if (emittedSubagentGroups.has(parentId)) {
      return;
    }
    emittedSubagentGroups.add(parentId);
    const isCollapsed = isSubagentGroupCollapsed(parentId);
    rows.push({
      kind: "pill",
      groupKind: "subagent",
      groupId: parentId,
      parentId,
      color: args.resolveSubagentColor(parentId),
      label: subagentLabel,
      isCollapsed,
    });
    if (isCollapsed) {
      return;
    }
    pushTopLevelWithChildren(parentId);
  }

  function isManualGroupCollapsed(group: DisplayManualChatGroup): boolean {
    return collapsedSet.has(group.id) && !manualGroupContainsActiveSession(group);
  }

  function isSubagentGroupCollapsed(parentId: string): boolean {
    return collapsedSet.has(parentId) && !subagentGroupContainsActiveSession(parentId);
  }

  function manualGroupContainsActiveSession(group: DisplayManualChatGroup): boolean {
    const activeSessionId = args.activeSessionId;
    if (!activeSessionId) {
      return false;
    }
    if (group.sessionIds.includes(activeSessionId)) {
      return true;
    }
    const activeTab = tabsBySessionId.get(activeSessionId);
    return !!activeTab?.isChild && group.sessionIds.includes(activeTab.groupRootSessionId);
  }

  function subagentGroupContainsActiveSession(parentId: string): boolean {
    const activeSessionId = args.activeSessionId;
    if (!activeSessionId) {
      return false;
    }
    return activeSessionId === parentId
      || childIdsByParentId.get(parentId)?.includes(activeSessionId) === true;
  }

  for (const tab of args.groupedTabs) {
    const manualGroup = manualGroupBySessionId.get(tab.isChild ? tab.groupRootSessionId : tab.sessionId);
    if (manualGroup) {
      emitManualGroup(manualGroup);
      continue;
    }

    if (tab.isChild) {
      emitSubagentGroup(tab.groupRootSessionId);
      continue;
    }

    if (args.childrenByParentSessionId.has(tab.sessionId) || childIdsByParentId.has(tab.sessionId)) {
      emitSubagentGroup(tab.sessionId);
      continue;
    }

    pushTab(tab.sessionId);
  }

  return rows;
}
