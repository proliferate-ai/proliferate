import { create } from "zustand";

interface ChatInputState {
  draftByWorkspaceId: Record<string, string>;
  setDraft: (workspaceId: string, value: string) => void;
  clearDraft: (workspaceId: string) => void;
}

export const useChatInputStore = create<ChatInputState>((set) => ({
  draftByWorkspaceId: {},

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
}));
