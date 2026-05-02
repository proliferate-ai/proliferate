import type {
  HeaderStripRow,
} from "@/lib/domain/workspaces/tabs/group-rows";
import type { DisplayManualChatGroup } from "@/lib/domain/workspaces/tabs/manual-groups";
import {
  buildHeaderShellRows,
  type HeaderShellStripRow,
  type ShellChatTab,
} from "@/lib/domain/workspaces/tabs/shell-rows";
import {
  buildWorkspaceShellTabs,
  getWorkspaceShellTabKey,
  resolveWorkspaceShellTabFromKey,
  type WorkspaceShellTab,
  type WorkspaceShellTabKey,
} from "@/lib/domain/workspaces/tabs/shell-tabs";
import type { ViewerTarget } from "@/lib/domain/workspaces/viewer-target";

export interface ResolveWorkspaceShellTabsStateArgs<TTab extends ShellChatTab> {
  selectedWorkspaceId: string | null;
  activeSessionId: string | null;
  storedActiveShellTabKey: WorkspaceShellTabKey | null;
  persistedShellOrderKeys: readonly WorkspaceShellTabKey[];
  shellChatSessionIds: readonly string[];
  openTargets: ViewerTarget[];
  stripRows: HeaderStripRow<TTab>[];
  displayManualGroups: readonly DisplayManualChatGroup[];
  subagentChildIdsByParentId: ReadonlyMap<string, readonly string[]>;
}

export interface ResolvedWorkspaceShellTabsState<TTab extends ShellChatTab> {
  activeShellTab: WorkspaceShellTab | null;
  activeShellTabKey: string | null;
  shellRows: HeaderShellStripRow<TTab>[];
  orderedTabs: WorkspaceShellTab[];
  orderedShellTabKeys: string[];
}

export function resolveWorkspaceShellTabsState<TTab extends ShellChatTab>({
  selectedWorkspaceId,
  activeSessionId,
  storedActiveShellTabKey,
  persistedShellOrderKeys,
  shellChatSessionIds,
  openTargets,
  stripRows,
  displayManualGroups,
  subagentChildIdsByParentId,
}: ResolveWorkspaceShellTabsStateArgs<TTab>): ResolvedWorkspaceShellTabsState<TTab> {
  const orderedTabs = buildWorkspaceShellTabs({
    selectedWorkspaceId,
    sessionSlots: Object.fromEntries(
      shellChatSessionIds.map((sessionId) => [
        sessionId,
        { sessionId, workspaceId: selectedWorkspaceId },
      ]),
    ),
    visibleChatSessionIds: [...shellChatSessionIds],
    openTargets,
    orderKeys: persistedShellOrderKeys,
  });
  const orderedShellTabKeys = orderedTabs.map(getWorkspaceShellTabKey);
  const stored = resolveWorkspaceShellTabFromKey(storedActiveShellTabKey, orderedTabs);
  const activeShellTab = stored
    ?? (
      activeSessionId
        ? orderedTabs.find((tab) =>
          tab.kind === "chat" && tab.sessionId === activeSessionId
        ) ?? null
        : null
    )
    ?? orderedTabs[0]
    ?? null;
  const activeShellTabKey = activeShellTab ? getWorkspaceShellTabKey(activeShellTab) : null;
  const shellRows = buildHeaderShellRows({
    stripRows,
    openTargets,
    orderedTabs,
    manualGroups: displayManualGroups,
    subagentChildIdsByParentId,
  });

  return {
    activeShellTab,
    activeShellTabKey,
    shellRows,
    orderedTabs,
    orderedShellTabKeys,
  };
}
