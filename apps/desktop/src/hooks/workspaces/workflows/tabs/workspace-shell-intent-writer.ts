import { invalidateSessionActivationIntent } from "#product/hooks/sessions/workflows/session-activation-guard";
import {
  chatShellWorkspaceIntentKey,
  chatWorkspaceShellTabKey,
  type ChatWorkspaceShellTabKey,
  type WorkspaceShellIntentKey,
} from "#product/lib/domain/workspaces/tabs/shell-tabs";
import { resolveWorkspaceShellStateKey } from "#product/lib/domain/workspaces/selection/workspace-ui-key";
import {
  type ShellIntentResult,
  useWorkspaceUiStore,
} from "#product/stores/preferences/workspace-ui-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

export type ChatShellIntentWrite<TIntent extends WorkspaceShellIntentKey = WorkspaceShellIntentKey> = ShellIntentResult & {
  shellWorkspaceId: string;
  intent: TIntent;
};

export function writeChatShellIntentForSession({
  workspaceId,
  shellWorkspaceId,
  sessionId,
  invalidateSessionIntent = true,
}: {
  workspaceId: string | null | undefined;
  shellWorkspaceId?: string | null;
  sessionId: string;
  invalidateSessionIntent?: boolean;
}): ChatShellIntentWrite<ChatWorkspaceShellTabKey> | null {
  if (!workspaceId) {
    return null;
  }
  const shellStateKey = resolveCurrentShellStateKey(workspaceId, shellWorkspaceId);
  const intent = chatWorkspaceShellTabKey(sessionId);

  if (invalidateSessionIntent) {
    invalidateSessionActivationIntent(workspaceId);
  }
  const write = useWorkspaceUiStore.getState().writeShellIntent({
    workspaceId: shellStateKey,
    intent,
  });
  clearPendingActivationSupersededByDirectWrite(shellStateKey, write.changed);
  return {
    ...write,
    shellWorkspaceId: shellStateKey,
    intent,
    epoch: useWorkspaceUiStore.getState().shellActivationEpochByWorkspace[shellStateKey]
      ?? write.epoch,
  };
}

export function writeChatShellIntentForEmptySurface({
  workspaceId,
  shellWorkspaceId,
  invalidateSessionIntent = true,
}: {
  workspaceId: string | null | undefined;
  shellWorkspaceId?: string | null;
  invalidateSessionIntent?: boolean;
}): ChatShellIntentWrite | null {
  if (!workspaceId) {
    return null;
  }
  const shellStateKey = resolveCurrentShellStateKey(workspaceId, shellWorkspaceId);
  const intent = chatShellWorkspaceIntentKey();

  if (invalidateSessionIntent) {
    invalidateSessionActivationIntent(workspaceId);
  }
  const write = useWorkspaceUiStore.getState().writeShellIntent({
    workspaceId: shellStateKey,
    intent,
  });
  clearPendingActivationSupersededByDirectWrite(shellStateKey, write.changed);
  return {
    ...write,
    shellWorkspaceId: shellStateKey,
    intent,
    epoch: useWorkspaceUiStore.getState().shellActivationEpochByWorkspace[shellStateKey]
      ?? write.epoch,
  };
}

function resolveCurrentShellStateKey(
  workspaceId: string,
  shellWorkspaceId: string | null | undefined,
): string {
  return resolveWorkspaceShellStateKey({
    workspaceId,
    shellWorkspaceId,
    selectedWorkspaceId: useSessionSelectionStore.getState().selectedWorkspaceId,
    selectedLogicalWorkspaceId: useSessionSelectionStore.getState().selectedLogicalWorkspaceId,
  }) ?? workspaceId;
}

function clearPendingActivationSupersededByDirectWrite(
  workspaceId: string,
  shellIntentChanged: boolean,
): void {
  const tabsStore = useWorkspaceUiStore.getState();
  const pending = tabsStore.pendingChatActivationByWorkspace[workspaceId] ?? null;
  if (!pending) {
    return;
  }
  tabsStore.clearPendingChatActivation({
    workspaceId,
    attemptId: pending.attemptId,
    bumpIfCurrent: !shellIntentChanged,
  });
}
