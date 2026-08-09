import { useCallback } from "react";
import { resolveChatDraftWorkspaceId } from "#product/lib/domain/chat/composer/chat-input";
import { resolveSelectedWorkspaceIdentity } from "#product/lib/domain/workspaces/selection/workspace-ui-key";
import {
  EMPTY_CHAT_DRAFT,
  isChatDraftEmpty,
  type ChatComposerDraft,
} from "#product/lib/domain/chat/composer/file-mention-draft-model";
import type { SelectedResponseContext } from "#product/domain/chats/transcript/selected-response-context";
import { useChatInputStore } from "#product/stores/chat/chat-input-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

const EMPTY_SELECTED_RESPONSE_CONTEXTS: readonly SelectedResponseContext[] = [];

/**
 * Live draft value for the composer editor.
 *
 * PERF (render isolation): this is the ONLY hook that subscribes to draft
 * content, and it belongs in the leaf that renders the textarea
 * (ChatInputDraftArea). Everything else uses `useChatDraftControls`, which
 * subscribes to just the `isEmpty` boolean — so a keystroke re-renders the
 * draft area, not the whole composer dock (model selector, config controls,
 * footer…).
 */
export function useChatDraftValue(workspaceUiKey: string | null): ChatComposerDraft {
  return useChatInputStore((state) =>
    workspaceUiKey ? state.draftByWorkspaceId[workspaceUiKey] ?? EMPTY_CHAT_DRAFT : EMPTY_CHAT_DRAFT,
  );
}

export function useChatSelectedResponseContexts(
  workspaceUiKey: string | null,
): readonly SelectedResponseContext[] {
  return useChatInputStore((state) =>
    workspaceUiKey
      ? state.selectedResponseContextsByWorkspaceId[workspaceUiKey]
        ?? EMPTY_SELECTED_RESPONSE_CONTEXTS
      : EMPTY_SELECTED_RESPONSE_CONTEXTS,
  );
}

/**
 * Draft controls + emptiness gate WITHOUT subscribing to draft content.
 *
 * `isEmpty` is a boolean selector (re-renders consumers only on
 * empty↔non-empty flips); `getDraft` reads the current draft imperatively for
 * submit-time serialization. Keystrokes do not re-render consumers of this
 * hook.
 */
export function useChatDraftControls() {
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
  const isEmpty = useChatInputStore((state) =>
    workspaceUiKey
      ? isChatDraftEmpty(state.draftByWorkspaceId[workspaceUiKey] ?? EMPTY_CHAT_DRAFT)
      : true,
  );
  const hasSelectedResponseContexts = useChatInputStore((state) =>
    workspaceUiKey
      ? (state.selectedResponseContextsByWorkspaceId[workspaceUiKey]?.length ?? 0) > 0
      : false,
  );
  const setDraftForWorkspace = useChatInputStore((state) => state.setDraft);
  const setDraftTextForWorkspace = useChatInputStore((state) => state.setDraftText);
  const appendDraftTextForWorkspace = useChatInputStore((state) => state.appendDraftText);
  const clearDraftForWorkspace = useChatInputStore((state) => state.clearDraft);
  const removeSelectedResponseContextForWorkspace = useChatInputStore(
    (state) => state.removeSelectedResponseContext,
  );
  const clearSelectedResponseContextsForWorkspace = useChatInputStore(
    (state) => state.clearSelectedResponseContexts,
  );

  const getDraft = useCallback((): ChatComposerDraft => {
    if (!workspaceUiKey) {
      return EMPTY_CHAT_DRAFT;
    }
    return useChatInputStore.getState().draftByWorkspaceId[workspaceUiKey] ?? EMPTY_CHAT_DRAFT;
  }, [workspaceUiKey]);

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

  const getSelectedResponseContexts = useCallback((): readonly SelectedResponseContext[] => {
    if (!workspaceUiKey) {
      return EMPTY_SELECTED_RESPONSE_CONTEXTS;
    }
    return useChatInputStore.getState()
      .selectedResponseContextsByWorkspaceId[workspaceUiKey]
      ?? EMPTY_SELECTED_RESPONSE_CONTEXTS;
  }, [workspaceUiKey]);

  const removeSelectedResponseContext = useCallback((id: string) => {
    if (!workspaceUiKey) {
      return;
    }
    removeSelectedResponseContextForWorkspace(workspaceUiKey, id);
  }, [removeSelectedResponseContextForWorkspace, workspaceUiKey]);

  const clearSelectedResponseContexts = useCallback((ids?: readonly string[]) => {
    if (!workspaceUiKey) {
      return;
    }
    clearSelectedResponseContextsForWorkspace(workspaceUiKey, ids);
  }, [clearSelectedResponseContextsForWorkspace, workspaceUiKey]);

  return {
    workspaceUiKey,
    materializedWorkspaceId,
    getDraft,
    getSelectedResponseContexts,
    setDraft,
    setDraftText,
    appendDraftText,
    clearDraft,
    removeSelectedResponseContext,
    clearSelectedResponseContexts,
    isEmpty,
    hasSelectedResponseContexts,
  };
}
