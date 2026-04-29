import { create } from "zustand";
import {
  appendTextToDraft,
  coerceChatDraft,
  EMPTY_CHAT_DRAFT,
  isChatDraftEmpty,
  type ChatComposerDraft,
} from "@/lib/domain/chat/file-mentions";

interface ChatInputState {
  draftByWorkspaceId: Record<string, ChatComposerDraft>;
  editDraftBySessionId: Record<string, string>;
  editingQueueSeqBySessionId: Record<string, number>;
  setDraft: (workspaceId: string, value: ChatComposerDraft) => void;
  setDraftText: (workspaceId: string, value: string) => void;
  appendDraftText: (workspaceId: string, value: string) => void;
  clearDraft: (workspaceId: string) => void;
  setEditDraft: (sessionId: string, value: string) => void;
  setEditingQueueSeq: (sessionId: string, seq: number | null) => void;
}

export const useChatInputStore = create<ChatInputState>((set) => ({
  draftByWorkspaceId: {},
  editDraftBySessionId: {},
  editingQueueSeqBySessionId: {},

  setDraft: (workspaceId, value) => set((state) => {
    const nextDrafts = { ...state.draftByWorkspaceId };
    const draft = coerceChatDraft(value);
    if (isChatDraftEmpty(draft)) {
      delete nextDrafts[workspaceId];
    } else {
      nextDrafts[workspaceId] = draft;
    }

    return {
      draftByWorkspaceId: nextDrafts,
    };
  }),

  setDraftText: (workspaceId, value) => set((state) => {
    const nextDrafts = { ...state.draftByWorkspaceId };
    const draft = coerceChatDraft(value);
    if (isChatDraftEmpty(draft)) {
      delete nextDrafts[workspaceId];
    } else {
      nextDrafts[workspaceId] = draft;
    }

    return {
      draftByWorkspaceId: nextDrafts,
    };
  }),

  appendDraftText: (workspaceId, value) => set((state) => {
    if (value.length === 0) {
      return state;
    }

    const current = state.draftByWorkspaceId[workspaceId] ?? EMPTY_CHAT_DRAFT;
    const draft = appendTextToDraft(current, value).draft;
    const nextDrafts = { ...state.draftByWorkspaceId };
    if (isChatDraftEmpty(draft)) {
      delete nextDrafts[workspaceId];
    } else {
      nextDrafts[workspaceId] = draft;
    }

    return {
      draftByWorkspaceId: nextDrafts,
    };
  }),

  clearDraft: (workspaceId) => set((state) => {
    if (!(workspaceId in state.draftByWorkspaceId)) {
      return state;
    }

    const nextDrafts = { ...state.draftByWorkspaceId };
    delete nextDrafts[workspaceId];
    return {
      draftByWorkspaceId: nextDrafts,
    };
  }),

  setEditDraft: (sessionId, value) => set((state) => {
    const nextEditDrafts = { ...state.editDraftBySessionId };
    if (value === "") {
      if (!(sessionId in nextEditDrafts)) {
        return state;
      }
      delete nextEditDrafts[sessionId];
    } else {
      nextEditDrafts[sessionId] = value;
    }

    return {
      editDraftBySessionId: nextEditDrafts,
    };
  }),

  setEditingQueueSeq: (sessionId, seq) => set((state) => {
    const nextEditing = { ...state.editingQueueSeqBySessionId };
    if (seq == null) {
      if (!(sessionId in nextEditing)) {
        return state;
      }
      delete nextEditing[sessionId];
    } else {
      nextEditing[sessionId] = seq;
    }

    return {
      editingQueueSeqBySessionId: nextEditing,
    };
  }),
}));
