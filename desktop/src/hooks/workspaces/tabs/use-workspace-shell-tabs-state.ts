import { useEffect, useMemo } from "react";
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
  parseWorkspaceShellTabKey,
  resolveWorkspaceShellTabFromKey,
  type WorkspaceShellTab,
  type WorkspaceShellTabKey,
} from "@/lib/domain/workspaces/tabs/shell-tabs";
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

  const orderedTabs = useMemo(
    () => buildWorkspaceShellTabs({
      selectedWorkspaceId,
      sessionSlots: Object.fromEntries(
        shellChatSessionIds.map((sessionId) => [
          sessionId,
          { sessionId, workspaceId: selectedWorkspaceId },
        ]),
      ),
      visibleChatSessionIds: [...shellChatSessionIds],
      openTabs,
      orderKeys: persistedShellOrderKeys,
    }),
    [
      openTabs,
      persistedShellOrderKeys,
      selectedWorkspaceId,
      shellChatSessionIds,
    ],
  );
  const orderedShellTabKeys = useMemo(
    () => orderedTabs.map(getWorkspaceShellTabKey),
    [orderedTabs],
  );
  const activeShellTab = useMemo<WorkspaceShellTab | null>(() => {
    const stored = resolveWorkspaceShellTabFromKey(storedActiveShellTabKey, orderedTabs);
    if (stored) {
      return stored;
    }
    if (activeSessionId) {
      const activeChat = orderedTabs.find((tab) =>
        tab.kind === "chat" && tab.sessionId === activeSessionId
      );
      if (activeChat) {
        return activeChat;
      }
    }
    return orderedTabs[0] ?? null;
  }, [activeSessionId, orderedTabs, storedActiveShellTabKey]);
  const activeShellTabKey = activeShellTab ? getWorkspaceShellTabKey(activeShellTab) : null;
  const shellRows = useMemo<HeaderShellStripRow<TTab>[]>(
    () => buildHeaderShellRows({
      stripRows,
      openTabs,
      orderedTabs,
      manualGroups: displayManualGroups,
      subagentChildIdsByParentId,
    }),
    [displayManualGroups, openTabs, orderedTabs, stripRows, subagentChildIdsByParentId],
  );

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
