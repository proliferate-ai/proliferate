import { useCallback } from "react";
import { resolveChatDraftWorkspaceId } from "@/lib/domain/chat/chat-input";
import {
  EMPTY_CHAT_DRAFT,
  isChatDraftEmpty,
  type ChatComposerDraft,
} from "@/lib/domain/chat/file-mentions";
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
    draftWorkspaceId ? state.draftByWorkspaceId[draftWorkspaceId] ?? EMPTY_CHAT_DRAFT : EMPTY_CHAT_DRAFT,
  );
  const setDraftForWorkspace = useChatInputStore((state) => state.setDraft);
  const setDraftTextForWorkspace = useChatInputStore((state) => state.setDraftText);
  const appendDraftTextForWorkspace = useChatInputStore((state) => state.appendDraftText);
  const clearDraftForWorkspace = useChatInputStore((state) => state.clearDraft);

  const setDraft = useCallback((value: ChatComposerDraft) => {
    if (!draftWorkspaceId) {
      return;
    }

    setDraftForWorkspace(draftWorkspaceId, value);
  }, [draftWorkspaceId, setDraftForWorkspace]);

  const setDraftText = useCallback((value: string) => {
    if (!draftWorkspaceId) {
      return;
    }

    setDraftTextForWorkspace(draftWorkspaceId, value);
  }, [draftWorkspaceId, setDraftTextForWorkspace]);

  const appendDraftText = useCallback((value: string) => {
    if (!draftWorkspaceId) {
      return;
    }

    appendDraftTextForWorkspace(draftWorkspaceId, value);
  }, [appendDraftTextForWorkspace, draftWorkspaceId]);

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
    setDraftText,
    appendDraftText,
    clearDraft,
    isEmpty: isChatDraftEmpty(draft),
  };
}
