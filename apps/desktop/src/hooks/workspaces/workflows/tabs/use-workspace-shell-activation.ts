import { useCallback } from "react";
import {
  clearActiveSession,
  invalidateSessionActivationIntent,
} from "@/hooks/sessions/workflows/session-activation-guard";
import {
  chatShellWorkspaceIntentKey,
  viewerWorkspaceShellTabKey,
} from "@/lib/domain/workspaces/tabs/shell-tabs";
import { fileViewerTarget, type ViewerTarget } from "@/lib/domain/workspaces/viewer/viewer-target";
import {
  rightPanelToolHeaderKey,
  rightPanelViewerHeaderKey,
} from "@/lib/domain/workspaces/shell/right-panel-model";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import {
  cancelPendingDeferredChatActivation,
  clearCurrentPendingForWorkspace,
  useChatTabActivation,
} from "@/hooks/workspaces/workflows/tabs/use-chat-tab-activation";
import { resolveCurrentShellStateKey } from "@/hooks/workspaces/workflows/tabs/workspace-shell-state-key";
import type {
  SelectSessionOptionsWithoutGuard,
} from "@/hooks/workspaces/workflows/tabs/workspace-shell-activation-types";

export type { SelectSessionOptionsWithoutGuard };

export type ShellActivationOutcome =
  | { result: "completed"; surface: "viewer" | "chat-shell"; shellActivationEpoch: number }
  | { result: "stale"; surface: "viewer" | "chat-shell"; reason: "intent-replaced" | "workspace-changed" };

export function useWorkspaceShellActivation() {
  const setActiveViewerTarget = useWorkspaceViewerTabsStore((state) => state.setActiveTarget);
  const writeShellIntent = useWorkspaceUiStore((state) => state.writeShellIntent);
  const activateChatTab = useChatTabActivation();

  const activateViewerTarget = useCallback(({
    workspaceId,
    shellWorkspaceId,
    target,
  }: {
    workspaceId: string;
    shellWorkspaceId?: string | null;
    target: ViewerTarget;
    mode?: "focus-existing" | "open-or-focus";
  }): ShellActivationOutcome => {
    const shellStateKey = resolveCurrentShellStateKey(workspaceId, shellWorkspaceId);
    invalidateSessionActivationIntent(workspaceId);
    const targetKey = viewerWorkspaceShellTabKey(target);
    setActiveViewerTarget(targetKey);
    openViewerTargetInRightPanel({
      materializedWorkspaceId: workspaceId,
      durableWorkspaceId: shellStateKey,
      target,
    });
    cancelPendingDeferredChatActivation(shellStateKey, "intent-replaced");
    clearCurrentPendingForWorkspace(shellStateKey);
    return {
      result: "completed",
      surface: "viewer",
      shellActivationEpoch:
        useWorkspaceUiStore.getState().shellActivationEpochByWorkspace[shellStateKey] ?? 0,
    };
  }, [setActiveViewerTarget]);

  const activateFileTab = useCallback(({
    workspaceId,
    shellWorkspaceId,
    path,
    mode,
  }: {
    workspaceId: string;
    shellWorkspaceId?: string | null;
    path: string;
    mode?: "focus-existing" | "open-or-focus";
  }) => activateViewerTarget({
    workspaceId,
    shellWorkspaceId,
    target: fileViewerTarget(path),
    mode,
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
