import { create } from "zustand";
import { appendTextToDraft } from "#product/lib/domain/chat/composer/file-mention-draft-edits";
import {
  coerceChatDraft,
  EMPTY_CHAT_DRAFT,
  isChatDraftEmpty,
  type ChatComposerDraft,
} from "#product/lib/domain/chat/composer/file-mention-draft-model";
import type { SelectedResponseContext } from "#product/domain/chats/transcript/selected-response-context";

let selectedResponseContextSequence = 0;

interface ChatInputState {
  draftByWorkspaceId: Record<string, ChatComposerDraft>;
  selectedResponseContextsByWorkspaceId: Record<string, SelectedResponseContext[]>;
  editDraftBySessionId: Record<string, string>;
  editingQueueSeqBySessionId: Record<string, number>;
  focusRequestNonce: number;
  setDraft: (workspaceId: string, value: ChatComposerDraft) => void;
  setDraftText: (workspaceId: string, value: string) => void;
  appendDraftText: (workspaceId: string, value: string) => void;
  clearDraft: (workspaceId: string) => void;
  addSelectedResponseContext: (
    workspaceId: string,
    text: string,
  ) => { id: string; ordinal: number } | null;
  setSelectedResponseContextComment: (
    workspaceId: string,
    id: string,
    comment: string,
  ) => void;
  removeSelectedResponseContext: (workspaceId: string, id: string) => void;
  clearSelectedResponseContexts: (workspaceId: string, ids?: readonly string[]) => void;
  setEditDraft: (sessionId: string, value: string) => void;
  setEditingQueueSeq: (sessionId: string, seq: number | null) => void;
  requestFocus: () => void;
}

export const useChatInputStore = create<ChatInputState>((set) => ({
  draftByWorkspaceId: {},
  selectedResponseContextsByWorkspaceId: {},
  editDraftBySessionId: {},
  editingQueueSeqBySessionId: {},
  focusRequestNonce: 0,

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

  addSelectedResponseContext: (workspaceId, text) => {
    if (text.trim().length === 0) {
      return null;
    }
    selectedResponseContextSequence += 1;
    const id = `selected-response:${Date.now()}:${selectedResponseContextSequence.toString(36)}`;
    let ordinal = 0;
    set((state) => {
      const current = state.selectedResponseContextsByWorkspaceId[workspaceId] ?? [];
      ordinal = current.length + 1;
      return {
        selectedResponseContextsByWorkspaceId: {
          ...state.selectedResponseContextsByWorkspaceId,
          [workspaceId]: [...current, { id, text }],
        },
      };
    });
    return { id, ordinal };
  },

  setSelectedResponseContextComment: (workspaceId, id, comment) => set((state) => {
    const current = state.selectedResponseContextsByWorkspaceId[workspaceId] ?? [];
    const index = current.findIndex((context) => context.id === id);
    if (index === -1) {
      return state;
    }
    const trimmed = comment.trim();
    const next = [...current];
    next[index] = { ...next[index]!, comment: trimmed || undefined };
    return {
      selectedResponseContextsByWorkspaceId: {
        ...state.selectedResponseContextsByWorkspaceId,
        [workspaceId]: next,
      },
    };
  }),

  removeSelectedResponseContext: (workspaceId, id) => set((state) => {
    const current = state.selectedResponseContextsByWorkspaceId[workspaceId] ?? [];
    const next = current.filter((context) => context.id !== id);
    if (next.length === current.length) {
      return state;
    }
    const selectedResponseContextsByWorkspaceId = {
      ...state.selectedResponseContextsByWorkspaceId,
    };
    if (next.length === 0) {
      delete selectedResponseContextsByWorkspaceId[workspaceId];
    } else {
      selectedResponseContextsByWorkspaceId[workspaceId] = next;
    }
    return { selectedResponseContextsByWorkspaceId };
  }),

  clearSelectedResponseContexts: (workspaceId, ids) => set((state) => {
    const current = state.selectedResponseContextsByWorkspaceId[workspaceId] ?? [];
    if (current.length === 0) {
      return state;
    }
    const idSet = ids ? new Set(ids) : null;
    const next = idSet
      ? current.filter((context) => !idSet.has(context.id))
      : [];
    if (next.length === current.length) {
      return state;
    }
    const selectedResponseContextsByWorkspaceId = {
      ...state.selectedResponseContextsByWorkspaceId,
    };
    if (next.length === 0) {
      delete selectedResponseContextsByWorkspaceId[workspaceId];
    } else {
      selectedResponseContextsByWorkspaceId[workspaceId] = next;
    }
    return { selectedResponseContextsByWorkspaceId };
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

  requestFocus: () => set((state) => ({
    focusRequestNonce: state.focusRequestNonce + 1,
  })),
}));
