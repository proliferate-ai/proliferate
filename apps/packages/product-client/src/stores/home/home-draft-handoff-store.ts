import { create } from "zustand";

interface HomeDraftHandoffState {
  draftText: string | null;
  setDraftText: (draftText: string) => void;
  clearDraftText: () => void;
}

export const useHomeDraftHandoffStore = create<HomeDraftHandoffState>((set) => ({
  draftText: null,

  setDraftText: (draftText) => set({
    draftText,
  }),

  clearDraftText: () => set({
    draftText: null,
  }),
}));
