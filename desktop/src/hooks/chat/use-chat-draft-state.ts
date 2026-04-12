import { useCallback } from "react";
import { resolveChatDraftWorkspaceId } from "@/lib/domain/chat/chat-input";
import { useChatInputStore } from "@/stores/chat/chat-input-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";

export function useChatDraftState() {
  const selectedLogicalWorkspaceId = useLogicalWorkspaceStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const draftWorkspaceId = resolveChatDraftWorkspaceId(
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
  );
  const draft = useChatInputStore((state) =>
    draftWorkspaceId ? state.draftByWorkspaceId[draftWorkspaceId] ?? "" : "",
  );
  const setDraftForWorkspace = useChatInputStore((state) => state.setDraft);
  const clearDraftForWorkspace = useChatInputStore((state) => state.clearDraft);

  const setDraft = useCallback((value: string) => {
    if (!draftWorkspaceId) {
      return;
    }

    setDraftForWorkspace(draftWorkspaceId, value);
  }, [draftWorkspaceId, setDraftForWorkspace]);

  const clearDraft = useCallback(() => {
    if (!draftWorkspaceId) {
      return;
    }

    clearDraftForWorkspace(draftWorkspaceId);
  }, [clearDraftForWorkspace, draftWorkspaceId]);

  return {
    selectedWorkspaceId: draftWorkspaceId,
    draft,
    setDraft,
    clearDraft,
    isEmpty: draft.trim().length === 0,
  };
}
