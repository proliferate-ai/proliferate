import { useCallback } from "react";
import { createPromptId } from "@/lib/domain/chat/prompt-id";
import type { PromptOutboxEntry } from "@/lib/domain/chat/prompt-outbox";
import { usePromptOutboxStore } from "@/stores/chat/prompt-outbox-store";

export function usePromptOutboxActions() {
  const retryPrompt = useCallback((clientPromptId: string) => {
    const store = usePromptOutboxStore.getState();
    const entry = store.entriesByPromptId[clientPromptId];
    if (!entry || !canRetryEntry(entry)) {
      return;
    }
    const retryPromptId = createPromptId();
    store.removeEntry(clientPromptId);
    store.enqueue({
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
  }, []);

  const dismissPrompt = useCallback((clientPromptId: string) => {
    const store = usePromptOutboxStore.getState();
    const entry = store.entriesByPromptId[clientPromptId];
    if (!entry || !canDismissEntry(entry)) {
      return;
    }
    store.removeEntry(clientPromptId);
  }, []);

  const cancelBeforeDispatch = useCallback((clientPromptId: string) => {
    const store = usePromptOutboxStore.getState();
    const entry = store.entriesByPromptId[clientPromptId];
    if (!entry || !canCancelLocally(entry)) {
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

function canRetryEntry(entry: PromptOutboxEntry): boolean {
  return entry.deliveryState === "failed_before_dispatch";
}

function canDismissEntry(entry: PromptOutboxEntry): boolean {
  return entry.deliveryState === "failed_before_dispatch";
}

function canCancelLocally(entry: PromptOutboxEntry): boolean {
  return entry.deliveryState === "waiting_for_session"
    || entry.deliveryState === "preparing";
}
