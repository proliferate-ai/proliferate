import { useCallback } from "react";
import { resolveChatDraftWorkspaceId } from "@/lib/domain/chat/composer/chat-input";
import { resolveSelectedWorkspaceIdentity } from "@/lib/domain/workspaces/selection/workspace-ui-key";
import {
  EMPTY_CHAT_DRAFT,
  isChatDraftEmpty,
  type ChatComposerDraft,
} from "@/lib/domain/chat/transcript/file-mentions";
import { useChatInputStore } from "@/stores/chat/chat-input-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

export function useChatDraftState() {
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const workspaceUiKey = resolveChatDraftWorkspaceId(
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
  );
  const { materializedWorkspaceId } = resolveSelectedWorkspaceIdentity({
    selectedLogicalWorkspaceId,
    materializedWorkspaceId: selectedWorkspaceId,
  });
  const draft = useChatInputStore((state) =>
    workspaceUiKey ? state.draftByWorkspaceId[workspaceUiKey] ?? EMPTY_CHAT_DRAFT : EMPTY_CHAT_DRAFT,
  );
  const setDraftForWorkspace = useChatInputStore((state) => state.setDraft);
  const setDraftTextForWorkspace = useChatInputStore((state) => state.setDraftText);
  const appendDraftTextForWorkspace = useChatInputStore((state) => state.appendDraftText);
  const clearDraftForWorkspace = useChatInputStore((state) => state.clearDraft);

  const setDraft = useCallback((value: ChatComposerDraft) => {
    if (!workspaceUiKey) {
      return;
    }

    setDraftForWorkspace(workspaceUiKey, value);
  }, [setDraftForWorkspace, workspaceUiKey]);

  const setDraftText = useCallback((value: string) => {
    if (!workspaceUiKey) {
      return;
    }

    setDraftTextForWorkspace(workspaceUiKey, value);
  }, [setDraftTextForWorkspace, workspaceUiKey]);

  const appendDraftText = useCallback((value: string) => {
    if (!workspaceUiKey) {
      return;
    }

    appendDraftTextForWorkspace(workspaceUiKey, value);
  }, [appendDraftTextForWorkspace, workspaceUiKey]);

  const clearDraft = useCallback(() => {
    if (!workspaceUiKey) {
      return;
    }

    clearDraftForWorkspace(workspaceUiKey);
  }, [clearDraftForWorkspace, workspaceUiKey]);

  return {
    workspaceUiKey,
    materializedWorkspaceId,
    draft,
    setDraft,
    setDraftText,
    appendDraftText,
    clearDraft,
    isEmpty: isChatDraftEmpty(draft),
  };
}
