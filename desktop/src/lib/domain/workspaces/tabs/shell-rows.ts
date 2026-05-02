import type {
  HeaderStripRow,
} from "@/lib/domain/workspaces/tabs/group-rows";
import {
  chatWorkspaceShellTabKey,
  type WorkspaceShellTab,
  type WorkspaceShellTabKey,
  viewerWorkspaceShellTabKey,
} from "@/lib/domain/workspaces/tabs/shell-tabs";
import type { GroupedChatTab } from "@/lib/domain/workspaces/tabs/grouping";
import { viewerTargetKey, type ViewerTarget } from "@/lib/domain/workspaces/viewer-target";

export interface ShellChatTab extends GroupedChatTab {
  id: string;
  visualGroupId: string | null;
}

export type HeaderShellStripRow<TTab extends ShellChatTab> =
  | {
    kind: "chat";
    row: HeaderStripRow<TTab>;
    shellKeys: WorkspaceShellTabKey[];
  }
  | {
    kind: "viewer";
    target: ViewerTarget;
    shellKey: WorkspaceShellTabKey;
  };

interface ManualGroupForShellRows {
  id: string;
  sessionIds: readonly string[];
}

interface ChatShellSlice<TTab extends ShellChatTab> {
  shellKeys: WorkspaceShellTabKey[];
  rows: HeaderStripRow<TTab>[];
}

export function buildHeaderShellRows<TTab extends ShellChatTab>({
  stripRows,
  openTargets,
  orderedTabs,
  manualGroups,
  subagentChildIdsByParentId,
}: {
  stripRows: HeaderStripRow<TTab>[];
  openTargets: readonly ViewerTarget[];
  orderedTabs: readonly WorkspaceShellTab[];
  manualGroups: readonly ManualGroupForShellRows[];
  subagentChildIdsByParentId?: ReadonlyMap<string, readonly string[]>;
}): HeaderShellStripRow<TTab>[] {
  const chatSlices = buildChatShellSlices(
    stripRows,
    manualGroups,
    subagentChildIdsByParentId ?? EMPTY_SUBAGENT_CHILD_IDS,
  );
  const sliceByKey = new Map<WorkspaceShellTabKey, ChatShellSlice<TTab>>();
  for (const slice of chatSlices) {
    for (const key of slice.shellKeys) {
      sliceByKey.set(key, slice);
    }
  }

  const emittedSlices = new Set<ChatShellSlice<TTab>>();
  const rows: HeaderShellStripRow<TTab>[] = [];
  const liveViewerTargetKeys = new Set(openTargets.map(viewerTargetKey));

  for (const tab of orderedTabs) {
    if (tab.kind === "viewer") {
      const shellKey = viewerWorkspaceShellTabKey(tab.target);
      if (liveViewerTargetKeys.has(shellKey)) {
        rows.push({
          kind: "viewer",
          target: tab.target,
          shellKey,
        });
      }
      continue;
    }

    const key = chatWorkspaceShellTabKey(tab.sessionId);
    const slice = sliceByKey.get(key);
    if (!slice || emittedSlices.has(slice)) {
      continue;
    }
    emittedSlices.add(slice);
    rows.push(...slice.rows.map((row) => ({
      kind: "chat" as const,
      row,
      shellKeys: slice.shellKeys,
    })));
  }

  for (const slice of chatSlices) {
    if (emittedSlices.has(slice) || !isCollapsedPillOnlySlice(slice)) {
      continue;
    }
    emittedSlices.add(slice);
    rows.push(...slice.rows.map((row) => ({
      kind: "chat" as const,
      row,
      shellKeys: slice.shellKeys,
    })));
  }

  return rows;
}

function isCollapsedPillOnlySlice<TTab extends ShellChatTab>(
  slice: ChatShellSlice<TTab>,
): boolean {
  return slice.rows.length === 1
    && slice.rows[0]?.kind === "pill"
    && slice.rows[0].isCollapsed;
}

function buildChatShellSlices<TTab extends ShellChatTab>(
  stripRows: HeaderStripRow<TTab>[],
  manualGroups: readonly ManualGroupForShellRows[],
  subagentChildIdsByParentId: ReadonlyMap<string, readonly string[]>,
): ChatShellSlice<TTab>[] {
  const manualGroupById = new Map(manualGroups.map((group) => [group.id, group]));
  const slices: ChatShellSlice<TTab>[] = [];
  let index = 0;

  while (index < stripRows.length) {
    const row = stripRows[index];
    if (row.kind === "tab") {
      slices.push({
        shellKeys: [chatWorkspaceShellTabKey(row.tab.sessionId)],
        rows: [row],
      });
      index += 1;
      continue;
    }

    const rows: HeaderStripRow<TTab>[] = [row];
    const shellKeys: WorkspaceShellTabKey[] = [];
    index += 1;

    while (index < stripRows.length) {
      const candidate = stripRows[index];
      if (
        candidate.kind !== "tab"
        || candidate.tab.visualGroupId !== row.groupId
      ) {
        break;
      }
      rows.push(candidate);
      shellKeys.push(chatWorkspaceShellTabKey(candidate.tab.sessionId));
      index += 1;
    }

    if (shellKeys.length === 0) {
      if (row.groupKind === "subagent") {
        shellKeys.push(
          ...[row.parentId, ...(subagentChildIdsByParentId.get(row.parentId) ?? [])]
            .map(chatWorkspaceShellTabKey),
        );
      } else {
        const manualGroup = manualGroupById.get(row.manualGroupId);
        shellKeys.push(
          ...(manualGroup?.sessionIds ?? []).map(chatWorkspaceShellTabKey),
        );
      }
    }

    slices.push({ shellKeys, rows });
  }

  return slices;
}

const EMPTY_SUBAGENT_CHILD_IDS = new Map<string, readonly string[]>();
