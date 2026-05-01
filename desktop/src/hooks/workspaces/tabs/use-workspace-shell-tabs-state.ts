import { useEffect, useMemo } from "react";
import type { HeaderStripRow } from "@/lib/domain/workspaces/tabs/group-rows";
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
  type WorkspaceShellTab,
  type WorkspaceShellTabKey,
} from "@/lib/domain/workspaces/tabs/shell-tabs";
import {
  resolveWorkspaceShellActivation,
  type WorkspaceShellActivation,
} from "@/lib/domain/workspaces/tabs/shell-activation";
import {
  resolveWithWorkspaceFallback,
  sameStringArray,
} from "@/lib/domain/workspaces/workspace-keyed-preferences";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";

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

  if (storedActiveShellTab?.kind === "file" || storedActiveShellTabKey === "chat-shell") {
    return null;
  }
  if (!storedActiveShellTabKey) {
    return fallbackSessionId;
  }
  return storedActiveShellTab?.kind === "chat"
    && storedActiveShellTab.sessionId === fallbackSessionId
    ? storedActiveShellTab.sessionId
    : null;
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
  activation: WorkspaceShellActivation;
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
  const activeFilePath = useWorkspaceFilesStore((state) => state.activeFilePath);
  const fileRestoreMarker = useWorkspaceFilesStore((state) => state.fileRestoreMarker);
  const workspaceSelectionNonce = useHarnessStore((state) => state.workspaceSelectionNonce);
  const sessionActivationEpoch = useHarnessStore((state) =>
    materializedWorkspaceId
      ? state.sessionActivationIntentEpochByWorkspace[materializedWorkspaceId] ?? 0
      : 0
  );

  const activeShellTabFallback = resolveWithWorkspaceFallback(
    activeShellTabKeyByWorkspace,
    workspaceUiKey,
    materializedWorkspaceId,
  );
  const shellStateKey =
    activeShellTabFallback.sourceKey ?? workspaceUiKey ?? materializedWorkspaceId;
  const pendingChatActivation = useWorkspaceUiStore((state) =>
    shellStateKey
      ? state.pendingChatActivationByWorkspace[shellStateKey] ?? null
      : null
  );
  const shellActivationEpoch = useWorkspaceUiStore((state) =>
    shellStateKey
      ? state.shellActivationEpochByWorkspace[shellStateKey] ?? 0
      : 0
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

  const orderedTabs = useMemo(
    () => buildWorkspaceShellTabs({
      selectedWorkspaceId: materializedWorkspaceId,
      sessionSlots: Object.fromEntries(
        shellChatSessionIds.map((sessionId) => [
          sessionId,
          { sessionId, workspaceId: materializedWorkspaceId },
        ]),
      ),
      visibleChatSessionIds: [...shellChatSessionIds],
      openTabs,
      orderKeys: persistedShellOrderKeys,
    }),
    [
      materializedWorkspaceId,
      openTabs,
      persistedShellOrderKeys,
      shellChatSessionIds,
    ],
  );
  const orderedShellTabKeys = useMemo(
    () => orderedTabs.map(getWorkspaceShellTabKey),
    [orderedTabs],
  );
  const activation = useMemo<WorkspaceShellActivation>(() => resolveWorkspaceShellActivation({
    workspaceId: materializedWorkspaceId ?? "",
    storedIntent: storedActiveShellTabKey,
    orderedTabs: orderedShellTabKeys,
    activeSessionId,
    activeFilePath,
    liveChatSessionIds: new Set(shellChatSessionIds),
    openFilePaths: new Set(openTabs),
    pendingChatActivation,
    currentShellActivationEpoch: shellActivationEpoch,
    currentSessionActivationEpoch: sessionActivationEpoch,
    currentWorkspaceSelectionNonce: workspaceSelectionNonce,
  }), [
    activeFilePath,
    activeSessionId,
    materializedWorkspaceId,
    openTabs,
    orderedShellTabKeys,
    pendingChatActivation,
    sessionActivationEpoch,
    shellActivationEpoch,
    shellChatSessionIds,
    storedActiveShellTabKey,
    workspaceSelectionNonce,
  ]);
  const activeShellTab = useMemo<WorkspaceShellTab | null>(() => {
    switch (activation.renderSurface.kind) {
      case "chat-session":
      case "chat-session-pending":
        return { kind: "chat", sessionId: activation.renderSurface.sessionId };
      case "file":
        return { kind: "file", path: activation.renderSurface.path };
      case "chat-shell":
        return null;
    }
  }, [activation.renderSurface]);
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
  }, [
    activeShellTabFallback.shouldWriteBack,
    activeShellTabFallback.value,
    fileRestoreReady,
    orderedShellTabKeys,
    persistedShellOrderKeys,
    setActiveShellTabKey,
    setShellTabOrder,
    shellOrderFallback.shouldWriteBack,
    shellOrderFallback.value,
    workspaceUiKey,
  ]);

  return {
    activeShellTab,
    activeShellTabKey,
    activation,
    shellRows,
    orderedTabs,
    orderedShellTabKeys,
  };
}
