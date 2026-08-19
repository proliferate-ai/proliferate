import { useCallback } from "react";
import {
  clearActiveSession,
  invalidateSessionActivationIntent,
} from "#product/hooks/sessions/workflows/session-activation-guard";
import {
  chatShellWorkspaceIntentKey,
  viewerWorkspaceShellTabKey,
} from "#product/lib/domain/workspaces/tabs/shell-tabs";
import { fileViewerTarget, type ViewerTarget } from "#product/lib/domain/workspaces/viewer/viewer-target";
import {
  rightPanelToolHeaderKey,
  rightPanelViewerHeaderKey,
} from "#product/lib/domain/workspaces/shell/right-panel-model";
import { useWorkspaceViewerTabsStore } from "#product/stores/editor/workspace-viewer-tabs-store";
import { useContentSearchStore } from "#product/stores/search/content-search-store";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import {
  cancelPendingDeferredChatActivation,
  clearCurrentPendingForWorkspace,
  useChatTabActivation,
} from "#product/hooks/workspaces/workflows/tabs/use-chat-tab-activation";
import { resolveCurrentShellStateKey } from "#product/hooks/workspaces/workflows/tabs/workspace-shell-state-key";
import type {
  SelectSessionOptionsWithoutGuard,
  ViewerActivationFocus,
} from "#product/hooks/workspaces/workflows/tabs/workspace-shell-activation-types";

export type { SelectSessionOptionsWithoutGuard };
export type { ViewerActivationFocus };

export type ShellActivationOutcome =
  | { result: "completed"; surface: "viewer" | "chat-shell"; shellActivationEpoch: number }
  | { result: "stale"; surface: "viewer" | "chat-shell"; reason: "intent-replaced" | "workspace-changed" };

export function useWorkspaceShellActivation() {
  const setActiveViewerTarget = useWorkspaceViewerTabsStore((state) => state.setActiveTarget);
  const requestViewerFocus = useWorkspaceViewerTabsStore((state) => state.requestViewerFocus);
  const writeShellIntent = useWorkspaceUiStore((state) => state.writeShellIntent);
  const activateChatTab = useChatTabActivation();

  const activateViewerTarget = useCallback(({
    workspaceId,
    shellWorkspaceId,
    target,
    focus = "viewer",
  }: {
    workspaceId: string;
    shellWorkspaceId?: string | null;
    target: ViewerTarget;
    focus?: ViewerActivationFocus;
  }): ShellActivationOutcome => {
    const shellStateKey = resolveCurrentShellStateKey(workspaceId, shellWorkspaceId);
    // Dismiss any open content search before the target changes, with
    // restoration suppressed: the outgoing file's still-connected Find control
    // must not reclaim focus from the tree row, tab, or incoming viewer.
    const searchStore = useContentSearchStore.getState();
    if (searchStore.open) {
      searchStore.closeSearch({ restoreFocus: false });
    }
    invalidateSessionActivationIntent(workspaceId);
    const targetKey = viewerWorkspaceShellTabKey(target);
    setActiveViewerTarget(targetKey);
    openViewerTargetInRightPanel({
      materializedWorkspaceId: workspaceId,
      durableWorkspaceId: shellStateKey,
      target,
    });
    // Only a viewer-focus intent on a frame-bearing target mints a request;
    // `promptAttachment` and `allChanges` render no file frame to receive one.
    if (focus === "viewer" && (target.kind === "file" || target.kind === "fileDiff")) {
      requestViewerFocus(targetKey);
    }
    cancelPendingDeferredChatActivation(shellStateKey, "intent-replaced");
    clearCurrentPendingForWorkspace(shellStateKey);
    return {
      result: "completed",
      surface: "viewer",
      shellActivationEpoch:
        useWorkspaceUiStore.getState().shellActivationEpochByWorkspace[shellStateKey] ?? 0,
    };
  }, [requestViewerFocus, setActiveViewerTarget]);

  const activateFileTab = useCallback(({
    workspaceId,
    shellWorkspaceId,
    path,
    focus,
  }: {
    workspaceId: string;
    shellWorkspaceId?: string | null;
    path: string;
    focus?: ViewerActivationFocus;
  }) => activateViewerTarget({
    workspaceId,
    shellWorkspaceId,
    target: fileViewerTarget(path),
    focus,
  }), [activateViewerTarget]);

  const activateChatShell = useCallback(({
    workspaceId,
    shellWorkspaceId,
  }: {
    workspaceId: string;
    shellWorkspaceId?: string | null;
    reason?: string;
  }): ShellActivationOutcome => {
    const shellStateKey = resolveCurrentShellStateKey(workspaceId, shellWorkspaceId);
    invalidateSessionActivationIntent(workspaceId);
    const write = writeShellIntent({
      workspaceId: shellStateKey,
      intent: chatShellWorkspaceIntentKey(),
    });
    clearActiveSession(workspaceId);
    cancelPendingDeferredChatActivation(shellStateKey, "intent-replaced");
    clearCurrentPendingForWorkspace(shellStateKey);
    return {
      result: "completed",
      surface: "chat-shell",
      shellActivationEpoch: write.epoch,
    };
  }, [writeShellIntent]);

  return {
    activateChatShell,
    activateChatTab,
    activateFileTab,
    activateViewerTarget,
  };
}

function openViewerTargetInRightPanel({
  materializedWorkspaceId,
  durableWorkspaceId,
  target,
}: {
  materializedWorkspaceId: string;
  durableWorkspaceId: string;
  target: ViewerTarget;
}): void {
  const activeEntryKey = target.kind === "allChanges"
    ? rightPanelToolHeaderKey("git")
    : rightPanelViewerHeaderKey(target);
  const store = useWorkspaceUiStore.getState();

  store.setRightPanelMaterializedForWorkspace(materializedWorkspaceId, (previous) => ({
    ...previous,
    activeEntryKey,
    headerOrder: previous.headerOrder.includes(activeEntryKey)
      ? previous.headerOrder
      : [...previous.headerOrder, activeEntryKey],
  }));
  store.setRightPanelOpenForWorkspace(durableWorkspaceId, true);
}
