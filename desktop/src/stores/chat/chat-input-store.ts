import { create } from "zustand";

interface ChatInputState {
  draftByWorkspaceId: Record<string, string>;
  editDraftBySessionId: Record<string, string>;
  editingQueueSeqBySessionId: Record<string, number>;
  setDraft: (workspaceId: string, value: string) => void;
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
    if (value === "") {
      delete nextDrafts[workspaceId];
    } else {
      nextDrafts[workspaceId] = value;
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
