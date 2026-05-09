import { useCallback } from "react";
import { createPromptId } from "@/lib/domain/chat/composer/prompt-id";
import {
  canCancelPromptOutboxEntryLocally,
  canDismissPromptOutboxEntry,
  canRetryPromptOutboxEntry,
} from "@/lib/domain/chat/outbox/prompt-outbox-actions";
import { useSessionCreationActions } from "@/hooks/sessions/use-session-creation-actions";
import { getSessionRecord } from "@/stores/sessions/session-records";
import { usePromptOutboxStore } from "@/stores/chat/prompt-outbox-store";

export function usePromptOutboxActions() {
  const { createSessionWithResolvedConfig } = useSessionCreationActions();
  const retryPrompt = useCallback((clientPromptId: string) => {
    const store = usePromptOutboxStore.getState();
    const entry = store.entriesByPromptId[clientPromptId];
    if (!entry || !canRetryPromptOutboxEntry(entry)) {
      return;
    }
    const retryPromptId = createPromptId();
    store.removeEntry(clientPromptId);
    const retryEntry = store.enqueue({
      clientPromptId: retryPromptId,
      retryOfPromptId: entry.clientPromptId,
      clientSessionId: entry.clientSessionId,
      materializedSessionId: entry.materializedSessionId,
      workspaceId: entry.workspaceId,
      text: entry.text,
      blocks: entry.blocks.map((block) => ({ ...block })),
      attachmentSnapshots: entry.attachmentSnapshots.map((snapshot) => ({ ...snapshot })),
      contentParts: entry.contentParts.map((part) => ({ ...part })),
      promptProvenance: entry.promptProvenance,
      placement: entry.placement,
      latencyFlowId: null,
    });
    const slot = getSessionRecord(entry.clientSessionId);
    const workspaceId = slot?.workspaceId ?? entry.workspaceId ?? null;
    if (!slot || slot.materializedSessionId || !workspaceId) {
      return;
    }
    void createSessionWithResolvedConfig({
      text: retryEntry.text,
      blocks: retryEntry.blocks,
      attachmentSnapshots: retryEntry.attachmentSnapshots,
      optimisticContentParts: retryEntry.contentParts,
      agentKind: slot.agentKind,
      modelId: slot.modelId ?? slot.agentKind,
      ...(slot.modeId ? { modeId: slot.modeId } : {}),
      workspaceId,
      promptId: retryPromptId,
      clientSessionId: entry.clientSessionId,
      skipInitialPromptEnqueue: true,
      preferExistingCompatibleSession: true,
    }).catch((error) => {
      const latest = usePromptOutboxStore.getState().entriesByPromptId[retryPromptId];
      if (!latest || latest.deliveryState !== "waiting_for_session") {
        return;
      }
      usePromptOutboxStore.getState().patchEntry(retryPromptId, {
        deliveryState: "failed_before_dispatch",
        errorMessage: error instanceof Error ? error.message : "Session creation failed.",
      });
    });
  }, [createSessionWithResolvedConfig]);

  const dismissPrompt = useCallback((clientPromptId: string) => {
    const store = usePromptOutboxStore.getState();
    const entry = store.entriesByPromptId[clientPromptId];
    if (!entry || !canDismissPromptOutboxEntry(entry)) {
      return;
    }
    store.removeEntry(clientPromptId);
  }, []);

  const cancelBeforeDispatch = useCallback((clientPromptId: string) => {
    const store = usePromptOutboxStore.getState();
    const entry = store.entriesByPromptId[clientPromptId];
    if (!entry || !canCancelPromptOutboxEntryLocally(entry)) {
      return;
    }
    store.removeEntry(clientPromptId);
  }, []);

  return {
    retryPrompt,
    dismissPrompt,
    cancelBeforeDispatch,
  };
}
