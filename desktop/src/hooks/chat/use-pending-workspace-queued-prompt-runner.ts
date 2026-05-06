import { useEffect, useMemo } from "react";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import { useSessionPromptWorkflow } from "@/hooks/sessions/use-session-prompt-workflow";
import { isSessionModelAvailabilityInterruption } from "@/hooks/sessions/use-session-model-availability-workflow";
import { useChatInputStore } from "@/stores/chat/chat-input-store";
import { usePendingWorkspaceQueuedPromptStore } from "@/stores/chat/pending-workspace-queued-prompt-store";
import { useToastStore } from "@/stores/toast/toast-store";

export function usePendingWorkspaceQueuedPromptRunner() {
  const queuedPromptsById = usePendingWorkspaceQueuedPromptStore((state) => state.queuedPrompts);
  const markConsuming = usePendingWorkspaceQueuedPromptStore((state) => state.markConsuming);
  const markFailed = usePendingWorkspaceQueuedPromptStore((state) => state.markFailed);
  const clear = usePendingWorkspaceQueuedPromptStore((state) => state.clear);
  const clearDraft = useChatInputStore((state) => state.clearDraft);
  const showToast = useToastStore((state) => state.show);
  const { createSessionWithResolvedConfig } = useSessionActions();
  const { promptSession } = useSessionPromptWorkflow();

  const readyPrompt = useMemo(
    () => Object.values(queuedPromptsById).find((prompt) =>
      prompt.status === "pending" && !!prompt.workspaceId
    ) ?? null,
    [queuedPromptsById],
  );

  useEffect(() => {
    if (!readyPrompt?.workspaceId) {
      return;
    }
    const workspaceId = readyPrompt.workspaceId;

    const consume = async () => {
      if (!markConsuming(readyPrompt.id)) {
        return;
      }

      const clearQueuedDraft = () => {
        clearDraft(readyPrompt.draftKey);
        clearDraft(workspaceId);
        if (readyPrompt.materializedDraftKey) {
          clearDraft(readyPrompt.materializedDraftKey);
        }
      };

      try {
        if (readyPrompt.sessionId) {
          await promptSession({
            sessionId: readyPrompt.sessionId,
            text: readyPrompt.text,
            blocks: readyPrompt.blocks,
            optimisticContentParts: readyPrompt.optimisticContentParts,
            workspaceId,
            promptId: readyPrompt.promptId,
            onBeforeOptimisticPrompt: clearQueuedDraft,
          });
        } else {
          await createSessionWithResolvedConfig({
            workspaceId,
            agentKind: readyPrompt.agentKind,
            modelId: readyPrompt.modelId,
            modeId: readyPrompt.modeId ?? undefined,
            projectedControlOverrides: readyPrompt.controlValues,
            text: readyPrompt.text,
            blocks: readyPrompt.blocks,
            optimisticContentParts: readyPrompt.optimisticContentParts,
            promptId: readyPrompt.promptId,
            onBeforeOptimisticPrompt: clearQueuedDraft,
          });
        }

        clear(readyPrompt.id);
      } catch (error) {
        if (!usePendingWorkspaceQueuedPromptStore.getState().queuedPrompts[readyPrompt.id]) {
          return;
        }
        if (isSessionModelAvailabilityInterruption(error)) {
          clear(readyPrompt.id);
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        markFailed(readyPrompt.id, message);
        showToast(`Workspace is ready, but the queued prompt could not be sent: ${message}`);
      }
    };

    void consume();
  }, [
    clear,
    clearDraft,
    createSessionWithResolvedConfig,
    markConsuming,
    markFailed,
    promptSession,
    readyPrompt,
    showToast,
  ]);
}
