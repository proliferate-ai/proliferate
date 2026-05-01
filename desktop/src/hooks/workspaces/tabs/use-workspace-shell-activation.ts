import { useCallback } from "react";
import {
  beginSessionActivationIntent,
  clearActiveSession,
  invalidateSessionActivationIntent,
  type SessionActivationGuard,
  type SessionActivationOutcome,
} from "@/hooks/sessions/session-activation-guard";
import {
  chatShellWorkspaceIntentKey,
  chatWorkspaceShellTabKey,
  fileWorkspaceShellTabKey,
} from "@/lib/domain/workspaces/tabs/shell-tabs";
import { resolveWorkspaceShellStateKey } from "@/lib/domain/workspaces/workspace-ui-key";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import type { MeasurementOperationId } from "@/lib/infra/debug-measurement";

export type ShellActivationOutcome =
  | { result: "completed"; surface: "file" | "chat-shell"; shellActivationEpoch: number }
  | { result: "stale"; surface: "file" | "chat-shell"; reason: "intent-replaced" | "workspace-changed" };

export interface SelectSessionOptionsWithoutGuard {
  latencyFlowId?: string | null;
  measurementOperationId?: MeasurementOperationId | null;
  allowColdIdleNoStream?: boolean;
  forceCold?: boolean;
}

export function useWorkspaceShellActivation() {
  const setActiveFileTab = useWorkspaceFilesStore((state) => state.setActiveTab);
  const writeShellIntent = useWorkspaceUiStore((state) => state.writeShellIntent);
  const setPendingChatActivation = useWorkspaceUiStore((state) => state.setPendingChatActivation);
  const clearPendingChatActivation = useWorkspaceUiStore((state) => state.clearPendingChatActivation);
  const rollbackShellIntent = useWorkspaceUiStore((state) => state.rollbackShellIntent);
  const { selectSession } = useSessionActions();

  const activateFileTab = useCallback(({
    workspaceId,
    shellWorkspaceId,
    path,
  }: {
    workspaceId: string;
    shellWorkspaceId?: string | null;
    path: string;
    mode?: "focus-existing" | "open-or-focus";
  }): ShellActivationOutcome => {
    const shellStateKey = resolveCurrentShellStateKey(workspaceId, shellWorkspaceId);
    invalidateSessionActivationIntent(workspaceId);
    setActiveFileTab(path);
    const write = writeShellIntent({
      workspaceId: shellStateKey,
      intent: fileWorkspaceShellTabKey(path),
    });
    clearCurrentPendingForWorkspace(shellStateKey);
    return {
      result: "completed",
      surface: "file",
      shellActivationEpoch: write.epoch,
    };
  }, [
    setActiveFileTab,
    writeShellIntent,
  ]);

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
    clearCurrentPendingForWorkspace(shellStateKey);
    return {
      result: "completed",
      surface: "chat-shell",
      shellActivationEpoch: write.epoch,
    };
  }, [writeShellIntent]);

  const activateChatTab = useCallback(async ({
    workspaceId,
    shellWorkspaceId,
    sessionId,
    selection,
  }: {
    workspaceId: string;
    shellWorkspaceId?: string | null;
    sessionId: string;
    revealHidden?: boolean;
    source?: string;
    selection?: SelectSessionOptionsWithoutGuard;
  }): Promise<SessionActivationOutcome> => {
    const shellStateKey = resolveCurrentShellStateKey(workspaceId, shellWorkspaceId);
    const guard = beginSessionActivationIntent(workspaceId);
    const intent = chatWorkspaceShellTabKey(sessionId);
    const previousWrite = writeShellIntent({
      workspaceId: shellStateKey,
      intent,
    });
    const pending = {
      attemptId: crypto.randomUUID(),
      sessionId,
      intent,
      guardToken: guard.token,
      workspaceSelectionNonce: guard.workspaceSelectionNonce,
      shellEpochAtWrite: previousWrite.epoch,
      sessionActivationEpochAtWrite: guard.token,
    };
    setPendingChatActivation({
      workspaceId: shellStateKey,
      pending,
    });
    try {
      const guardedSelectSession = selectSession as (
        targetSessionId: string,
        targetOptions: SelectSessionOptionsWithoutGuard & { guard: SessionActivationGuard },
      ) => Promise<SessionActivationOutcome | void>;
      const outcome = await guardedSelectSession(sessionId, {
        ...selection,
        guard,
      });
      if (outcome?.result === "completed" || outcome?.result === "stale") {
        if (outcome.result === "stale") {
          rollbackShellIntent({
            workspaceId: shellStateKey,
            expectedIntent: intent,
            expectedEpoch: previousWrite.epoch,
            expectedPendingAttemptId: pending.attemptId,
            rollbackIntent: previousWrite.previousIntent,
          });
        }
        clearPendingChatActivation({
          workspaceId: shellStateKey,
          attemptId: pending.attemptId,
          bumpIfCurrent: false,
        });
        return outcome;
      }
      clearPendingChatActivation({
        workspaceId: shellStateKey,
        attemptId: pending.attemptId,
        bumpIfCurrent: false,
      });
      return {
        result: "completed",
        sessionId,
        guard,
        activeSessionVersion: 0,
      };
    } catch (error) {
      rollbackShellIntent({
        workspaceId: shellStateKey,
        expectedIntent: intent,
        expectedEpoch: previousWrite.epoch,
        expectedPendingAttemptId: pending.attemptId,
        rollbackIntent: previousWrite.previousIntent,
      });
      clearPendingChatActivation({
        workspaceId: shellStateKey,
        attemptId: pending.attemptId,
        bumpIfCurrent: false,
      });
      throw error;
    }
  }, [
    clearPendingChatActivation,
    rollbackShellIntent,
    selectSession,
    setPendingChatActivation,
    writeShellIntent,
  ]);

  return {
    activateChatShell,
    activateChatTab,
    activateFileTab,
  };
}

function clearCurrentPendingForWorkspace(workspaceId: string): void {
  const pending = useWorkspaceUiStore.getState().pendingChatActivationByWorkspace[workspaceId];
  if (!pending) {
    return;
  }
  useWorkspaceUiStore.getState().clearPendingChatActivation({
    workspaceId,
    attemptId: pending.attemptId,
    bumpIfCurrent: false,
  });
}

function resolveCurrentShellStateKey(
  workspaceId: string,
  shellWorkspaceId: string | null | undefined,
): string {
  return resolveWorkspaceShellStateKey({
    workspaceId,
    shellWorkspaceId,
    selectedWorkspaceId: useHarnessStore.getState().selectedWorkspaceId,
    selectedLogicalWorkspaceId: useLogicalWorkspaceStore.getState().selectedLogicalWorkspaceId,
  }) ?? workspaceId;
}
