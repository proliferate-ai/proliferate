import { useCallback } from "react";
import { resolveChatDraftWorkspaceId } from "@/lib/domain/chat/chat-input";
import { resolveSelectedWorkspaceIdentity } from "@/lib/domain/workspaces/workspace-ui-key";
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
