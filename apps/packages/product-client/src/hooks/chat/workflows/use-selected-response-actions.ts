import { useCallback } from "react";
import { CHAT_SELECTED_RESPONSE_ACTIONS } from "#product/copy/chat/chat-copy";
import { buildPromptWithSelectedResponseContexts } from "#product/domain/chats/transcript/selected-response-context";
import { useChatPromptActions } from "#product/hooks/chat/workflows/use-chat-prompt-actions";
import { resolveChatDraftWorkspaceId } from "#product/lib/domain/chat/composer/chat-input";
import { useChatInputStore } from "#product/stores/chat/chat-input-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useToastStore } from "#product/stores/toast/toast-store";

export function useSelectedResponseActions() {
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const workspaceUiKey = resolveChatDraftWorkspaceId(
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
  );
  const addSelectedResponseContext = useChatInputStore(
    (state) => state.addSelectedResponseContext,
  );
  const requestComposerFocus = useChatInputStore((state) => state.requestFocus);
  const showToast = useToastStore((state) => state.show);
  const currentChat = useChatPromptActions();

  const addToChat = useCallback((text: string) => {
    if (!workspaceUiKey) {
      return;
    }
    addSelectedResponseContext(workspaceUiKey, text);
    requestComposerFocus();
  }, [addSelectedResponseContext, requestComposerFocus, workspaceUiKey]);

  const moreDetails = useCallback((text: string) => {
    const payload = buildPromptWithSelectedResponseContexts(
      CHAT_SELECTED_RESPONSE_ACTIONS.moreDetailsPrompt,
      [{ text }],
    );
    void currentChat.handleSubmit({
      ...payload,
      preserveDraft: true,
    }).then((submitted) => {
      if (!submitted && currentChat.submitDisabledReason) {
        showToast(currentChat.submitDisabledReason);
      }
    });
  }, [currentChat.handleSubmit, currentChat.submitDisabledReason, showToast]);

  return {
    addToChat,
    moreDetails,
  };
}
