import { useEffect, useMemo } from "react";
import type { HeaderStripRow } from "@/lib/domain/workspaces/tabs/group-rows";
import type { DisplayManualChatGroup } from "@/lib/domain/workspaces/tabs/manual-groups";
import {
  type HeaderShellStripRow,
  type ShellChatTab,
} from "@/lib/domain/workspaces/tabs/shell-rows";
import {
  parseWorkspaceShellTabKey,
  type WorkspaceShellTab,
  type WorkspaceShellTabKey,
} from "@/lib/domain/workspaces/tabs/shell-tabs";
import { resolveWorkspaceShellTabsState } from "@/lib/domain/workspaces/tabs/shell-tab-state";
import { useWorkspaceTabsStore } from "@/stores/workspaces/workspace-tabs-store";

const EMPTY_SHELL_TAB_ORDER_KEYS: readonly WorkspaceShellTabKey[] = [];

export function useWorkspaceActiveChatTabId({
  selectedWorkspaceId,
  fallbackSessionId,
}: {
  selectedWorkspaceId: string | null;
  fallbackSessionId: string | null;
}): string | null {
  const storedActiveShellTabKey = useWorkspaceTabsStore((state) =>
    selectedWorkspaceId
      ? state.activeShellTabKeyByWorkspace[selectedWorkspaceId] ?? null
      : null
  );
  const storedActiveShellTab = storedActiveShellTabKey
    ? parseWorkspaceShellTabKey(storedActiveShellTabKey)
    : null;

  if (storedActiveShellTab?.kind === "file") {
    return null;
  }
  return storedActiveShellTab?.kind === "chat"
    ? storedActiveShellTab.sessionId
    : fallbackSessionId;
}

export function useWorkspaceShellTabsState<TTab extends ShellChatTab>({
  selectedWorkspaceId,
  activeSessionId,
  shellChatSessionIds,
  openTabs,
  stripRows,
  displayManualGroups,
  subagentChildIdsByParentId,
}: {
  selectedWorkspaceId: string | null;
  activeSessionId: string | null;
  shellChatSessionIds: readonly string[];
  openTabs: string[];
  stripRows: HeaderStripRow<TTab>[];
  displayManualGroups: readonly DisplayManualChatGroup[];
  subagentChildIdsByParentId: ReadonlyMap<string, readonly string[]>;
}): {
  activeShellTab: WorkspaceShellTab | null;
  activeShellTabKey: string | null;
  shellRows: HeaderShellStripRow<TTab>[];
  orderedTabs: WorkspaceShellTab[];
  orderedShellTabKeys: string[];
} {
  const storedActiveShellTabKey = useWorkspaceTabsStore((state) =>
    selectedWorkspaceId
      ? state.activeShellTabKeyByWorkspace[selectedWorkspaceId] ?? null
      : null
  );
  const persistedShellOrderKeys = useWorkspaceTabsStore((state) =>
    selectedWorkspaceId
      ? state.shellTabOrderByWorkspace[selectedWorkspaceId] ?? EMPTY_SHELL_TAB_ORDER_KEYS
      : EMPTY_SHELL_TAB_ORDER_KEYS
  );
  const setActiveShellTabKey = useWorkspaceTabsStore((state) => state.setActiveShellTabKey);
  const setShellTabOrder = useWorkspaceTabsStore((state) => state.setShellTabOrder);

  const resolved = useMemo(
    () => resolveWorkspaceShellTabsState({
      selectedWorkspaceId,
      activeSessionId,
      storedActiveShellTabKey,
      persistedShellOrderKeys,
      shellChatSessionIds,
      openTabs,
      stripRows,
      displayManualGroups,
      subagentChildIdsByParentId,
    }),
    [
      activeSessionId,
      displayManualGroups,
      openTabs,
      persistedShellOrderKeys,
      selectedWorkspaceId,
      shellChatSessionIds,
      storedActiveShellTabKey,
      stripRows,
      subagentChildIdsByParentId,
    ],
  );
  const {
    activeShellTab,
    activeShellTabKey,
    shellRows,
    orderedTabs,
    orderedShellTabKeys,
  } = resolved;

  useEffect(() => {
    if (!selectedWorkspaceId) {
      return;
    }
    if (!sameStringArray(persistedShellOrderKeys, orderedShellTabKeys)) {
      setShellTabOrder(selectedWorkspaceId, orderedShellTabKeys);
    }
    if (storedActiveShellTabKey !== activeShellTabKey) {
      setActiveShellTabKey(selectedWorkspaceId, activeShellTabKey);
    }
  }, [
    activeShellTabKey,
    orderedShellTabKeys,
    persistedShellOrderKeys,
    selectedWorkspaceId,
    setActiveShellTabKey,
    setShellTabOrder,
    storedActiveShellTabKey,
  ]);

  return {
    activeShellTab,
    activeShellTabKey,
    shellRows,
    orderedTabs,
    orderedShellTabKeys,
  };
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
