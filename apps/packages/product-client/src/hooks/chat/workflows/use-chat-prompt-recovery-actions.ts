import { useCallback } from "react";
import { useSessionCreationActions } from "#product/hooks/sessions/workflows/use-session-creation-actions";
import {
  useChatPromptRecoveryStore,
  type ChatPromptRecovery,
} from "#product/stores/chat/chat-prompt-recovery-store";
import { useToastStore } from "#product/stores/toast/toast-store";

export function useChatPromptRecoveryActions(workspaceUiKey: string | null) {
  const { createSessionWithResolvedConfig } = useSessionCreationActions();
  const showErrorToast = useToastStore((state) => state.showError);

  const dismissRecovery = useCallback((recoveryId: string) => {
    if (workspaceUiKey) {
      useChatPromptRecoveryStore.getState().removeRecovery(workspaceUiKey, recoveryId);
    }
  }, [workspaceUiKey]);

  const retryRecovery = useCallback(async function retryRecovery(
    recovery: ChatPromptRecovery,
  ) {
    if (!workspaceUiKey) {
      return false;
    }
    try {
      await createSessionWithResolvedConfig({
        text: recovery.prompt.text,
        blocks: recovery.prompt.blocks.map((block) => ({ ...block })),
        attachmentSnapshots: recovery.prompt.attachmentSnapshots
          .map((snapshot) => ({ ...snapshot })),
        optimisticContentParts: recovery.prompt.contentParts.map((part) => ({ ...part })),
        agentKind: recovery.agentKind,
        modelId: recovery.modelId,
        ...(recovery.modeId ? { modeId: recovery.modeId } : {}),
        workspaceId: recovery.workspaceId,
        promptId: recovery.prompt.clientPromptId,
      });
      useChatPromptRecoveryStore.getState().removeRecovery(workspaceUiKey, recovery.id);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showErrorToast({
        headline: "Message not sent",
        consequence: "It is still held for recovery; nothing was lost.",
        cause: message,
        retry: () => void retryRecovery(recovery),
      });
      return false;
    }
  }, [createSessionWithResolvedConfig, showErrorToast, workspaceUiKey]);

  return { dismissRecovery, retryRecovery };
}
