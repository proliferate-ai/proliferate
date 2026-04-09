import { useCallback } from "react";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useChatInputStore } from "@/stores/chat/chat-input-store";

export function useChatDraftState() {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const draft = useChatInputStore((state) =>
    selectedWorkspaceId ? state.draftByWorkspaceId[selectedWorkspaceId] ?? "" : "",
  );
  const setDraftForWorkspace = useChatInputStore((state) => state.setDraft);
  const clearDraftForWorkspace = useChatInputStore((state) => state.clearDraft);

  const setDraft = useCallback((value: string) => {
    if (!selectedWorkspaceId) {
      return;
    }

    setDraftForWorkspace(selectedWorkspaceId, value);
  }, [selectedWorkspaceId, setDraftForWorkspace]);

  const clearDraft = useCallback(() => {
    if (!selectedWorkspaceId) {
      return;
    }

    clearDraftForWorkspace(selectedWorkspaceId);
  }, [clearDraftForWorkspace, selectedWorkspaceId]);

  return {
    selectedWorkspaceId,
    draft,
    setDraft,
    clearDraft,
    isEmpty: draft.trim().length === 0,
  };
}
