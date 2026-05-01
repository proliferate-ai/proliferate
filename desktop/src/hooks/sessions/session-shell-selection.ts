import type {
  SessionActivationGuard,
  SessionActivationOutcome,
} from "@/hooks/sessions/session-activation-guard";
import { beginSessionActivationIntent } from "@/hooks/sessions/session-activation-guard";
import { writeChatShellIntentForSession } from "@/hooks/workspaces/tabs/workspace-shell-intent-writer";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";

export interface SessionShellSelectionOptions {
  latencyFlowId?: string | null;
  allowColdIdleNoStream?: boolean;
  forceCold?: boolean;
}

export async function selectSessionWithShellIntentRollback(input: {
  workspaceId: string;
  sessionId: string;
  options?: SessionShellSelectionOptions;
  selectSession: (
    sessionId: string,
    options?: SessionShellSelectionOptions & { guard?: SessionActivationGuard },
  ) => Promise<SessionActivationOutcome | void>;
}): Promise<SessionActivationOutcome | void> {
  const guard = beginSessionActivationIntent(input.workspaceId);
  const shellWrite = writeChatShellIntentForSession({
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    invalidateSessionIntent: false,
  });
  const pendingAttemptId = crypto.randomUUID();
  if (shellWrite) {
    useWorkspaceUiStore.getState().setPendingChatActivation({
      workspaceId: shellWrite.shellWorkspaceId,
      pending: {
        attemptId: pendingAttemptId,
        sessionId: input.sessionId,
        intent: shellWrite.intent,
        guardToken: guard.token,
        workspaceSelectionNonce: guard.workspaceSelectionNonce,
        shellEpochAtWrite: shellWrite.epoch,
        sessionActivationEpochAtWrite: guard.token,
      },
    });
  }
  try {
    const outcome = await input.selectSession(input.sessionId, {
      ...input.options,
      guard,
    });
    if (outcome?.result === "stale" && shellWrite) {
      useWorkspaceUiStore.getState().rollbackShellIntent({
        workspaceId: shellWrite.shellWorkspaceId,
        expectedIntent: shellWrite.currentIntent,
        expectedEpoch: shellWrite.epoch,
        expectedPendingAttemptId: pendingAttemptId,
        rollbackIntent: shellWrite.previousIntent,
      });
    }
    if (shellWrite) {
      useWorkspaceUiStore.getState().clearPendingChatActivation({
        workspaceId: shellWrite.shellWorkspaceId,
        attemptId: pendingAttemptId,
        bumpIfCurrent: false,
      });
    }
    return outcome;
  } catch (error) {
    if (shellWrite) {
      useWorkspaceUiStore.getState().rollbackShellIntent({
        workspaceId: shellWrite.shellWorkspaceId,
        expectedIntent: shellWrite.currentIntent,
        expectedEpoch: shellWrite.epoch,
        expectedPendingAttemptId: pendingAttemptId,
        rollbackIntent: shellWrite.previousIntent,
      });
      useWorkspaceUiStore.getState().clearPendingChatActivation({
        workspaceId: shellWrite.shellWorkspaceId,
        attemptId: pendingAttemptId,
        bumpIfCurrent: false,
      });
    }
    throw error;
  }
}
