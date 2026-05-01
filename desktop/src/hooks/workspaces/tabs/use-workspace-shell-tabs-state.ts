import { useEffect, useMemo } from "react";
import type { HeaderStripRow } from "@/lib/domain/workspaces/tabs/group-rows";
import type { DisplayManualChatGroup } from "@/lib/domain/workspaces/tabs/manual-groups";
import {
  type HeaderShellStripRow,
  type ShellChatTab,
} from "@/lib/domain/workspaces/tabs/shell-rows";
import { resolveWorkspaceShellTabsState } from "@/lib/domain/workspaces/tabs/shell-tab-state";
import {
  parseWorkspaceShellTabKey,
  type WorkspaceShellTab,
  type WorkspaceShellTabKey,
} from "@/lib/domain/workspaces/tabs/shell-tabs";
import {
  resolveWithWorkspaceFallback,
  sameStringArray,
} from "@/lib/domain/workspaces/workspace-keyed-preferences";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";

const EMPTY_SHELL_TAB_ORDER_KEYS: readonly WorkspaceShellTabKey[] = [];

export function useWorkspaceActiveChatTabId({
  workspaceUiKey,
  materializedWorkspaceId,
  fallbackSessionId,
}: {
  workspaceUiKey: string | null;
  materializedWorkspaceId: string | null;
  fallbackSessionId: string | null;
}): string | null {
  const activeShellTabKeyByWorkspace = useWorkspaceUiStore(
    (state) => state.activeShellTabKeyByWorkspace,
  );
  const storedActiveShellTabKey = resolveWithWorkspaceFallback(
    activeShellTabKeyByWorkspace,
    workspaceUiKey,
    materializedWorkspaceId,
  ).value ?? null;
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
  workspaceUiKey,
  materializedWorkspaceId,
  activeSessionId,
  shellChatSessionIds,
  openTabs,
  stripRows,
  displayManualGroups,
  subagentChildIdsByParentId,
}: {
  workspaceUiKey: string | null;
  materializedWorkspaceId: string | null;
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
  const activeShellTabKeyByWorkspace = useWorkspaceUiStore(
    (state) => state.activeShellTabKeyByWorkspace,
  );
  const shellTabOrderByWorkspace = useWorkspaceUiStore(
    (state) => state.shellTabOrderByWorkspace,
  );
  const setActiveShellTabKey = useWorkspaceUiStore(
    (state) => state.setActiveShellTabKeyForWorkspace,
  );
  const setShellTabOrder = useWorkspaceUiStore(
    (state) => state.setShellTabOrderForWorkspace,
  );
  const fileRestoreMarker = useWorkspaceFilesStore((state) => state.fileRestoreMarker);

  const activeShellTabFallback = resolveWithWorkspaceFallback(
    activeShellTabKeyByWorkspace,
    workspaceUiKey,
    materializedWorkspaceId,
  );
  const shellOrderFallback = resolveWithWorkspaceFallback(
    shellTabOrderByWorkspace,
    workspaceUiKey,
    materializedWorkspaceId,
  );
  const storedActiveShellTabKey = activeShellTabFallback.value ?? null;
  const persistedShellOrderKeys =
    shellOrderFallback.value ?? EMPTY_SHELL_TAB_ORDER_KEYS;
  const persistedShellStateIncludesFile = useMemo(
    () => {
      if (persistedShellOrderKeys.some((key) =>
        parseWorkspaceShellTabKey(key)?.kind === "file"
      )) {
        return true;
      }
      return storedActiveShellTabKey
        ? parseWorkspaceShellTabKey(storedActiveShellTabKey)?.kind === "file"
        : false;
    },
    [persistedShellOrderKeys, storedActiveShellTabKey],
  );
  const fileRestoreReady = !persistedShellStateIncludesFile || Boolean(
    fileRestoreMarker?.ready
      && fileRestoreMarker.workspaceUiKey === workspaceUiKey
      && fileRestoreMarker.materializedWorkspaceId === materializedWorkspaceId,
  );

  const resolved = useMemo(
    () => resolveWorkspaceShellTabsState({
      selectedWorkspaceId: materializedWorkspaceId,
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
      materializedWorkspaceId,
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
    if (!workspaceUiKey) {
      return;
    }
    let wroteFallback = false;
    if (shellOrderFallback.shouldWriteBack && shellOrderFallback.value !== undefined) {
      setShellTabOrder(workspaceUiKey, shellOrderFallback.value);
      wroteFallback = true;
    }
    if (activeShellTabFallback.shouldWriteBack) {
      setActiveShellTabKey(workspaceUiKey, activeShellTabFallback.value ?? null);
      wroteFallback = true;
    }
    if (wroteFallback || !fileRestoreReady) {
      return;
    }
    if (!sameStringArray(persistedShellOrderKeys, orderedShellTabKeys)) {
      setShellTabOrder(workspaceUiKey, orderedShellTabKeys);
    }
    if (storedActiveShellTabKey !== activeShellTabKey) {
      setActiveShellTabKey(workspaceUiKey, activeShellTabKey);
    }
  }, [
    activeShellTabFallback.shouldWriteBack,
    activeShellTabFallback.value,
    activeShellTabKey,
    fileRestoreReady,
    orderedShellTabKeys,
    persistedShellOrderKeys,
    setActiveShellTabKey,
    setShellTabOrder,
    shellOrderFallback.shouldWriteBack,
    shellOrderFallback.value,
    storedActiveShellTabKey,
    workspaceUiKey,
  ]);

  return {
    activeShellTab,
    activeShellTabKey,
    shellRows,
    orderedTabs,
    orderedShellTabKeys,
  };
}
