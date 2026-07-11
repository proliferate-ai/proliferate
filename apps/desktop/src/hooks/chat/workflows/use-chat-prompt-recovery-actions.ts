import { useCallback } from "react";
import { useSessionCreationActions } from "@/hooks/sessions/workflows/use-session-creation-actions";
import {
  useChatPromptRecoveryStore,
  type ChatPromptRecovery,
} from "@/stores/chat/chat-prompt-recovery-store";
import { useToastStore } from "@/stores/toast/toast-store";

export function useChatPromptRecoveryActions(workspaceUiKey: string | null) {
  const { createSessionWithResolvedConfig } = useSessionCreationActions();
  const showToast = useToastStore((state) => state.show);

  const dismissRecovery = useCallback((recoveryId: string) => {
    if (workspaceUiKey) {
      useChatPromptRecoveryStore.getState().removeRecovery(workspaceUiKey, recoveryId);
    }
  }, [workspaceUiKey]);

  const retryRecovery = useCallback(async (recovery: ChatPromptRecovery) => {
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
      showToast(`Failed to retry message: ${message}`);
      return false;
    }
  }, [createSessionWithResolvedConfig, showToast, workspaceUiKey]);

  return { dismissRecovery, retryRecovery };
}
