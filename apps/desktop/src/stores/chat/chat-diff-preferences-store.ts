import { create } from "zustand";

export const CHAT_DIFF_PREFERENCES_STORAGE_KEY = "proliferate.chatDiffPreferences.v1";

interface ChatDiffPreferencesState {
  wrapLongLines: boolean;
  _hydrated: boolean;
  _persistenceRevision: number;
  hydrate: (wrapLongLines: boolean) => void;
  setWrapLongLines: (wrapLongLines: boolean) => void;
  toggleWrapLongLines: () => void;
}

export const useChatDiffPreferencesStore = create<ChatDiffPreferencesState>((set) => ({
  wrapLongLines: false,
  _hydrated: false,
  _persistenceRevision: 0,
  hydrate: (wrapLongLines) => set({ wrapLongLines, _hydrated: true }),

  setWrapLongLines: (wrapLongLines) => {
    set((state) => ({
      wrapLongLines,
      _persistenceRevision: state._persistenceRevision + 1,
    }));
  },

  toggleWrapLongLines: () => {
    set((state) => ({
      wrapLongLines: !state.wrapLongLines,
      _persistenceRevision: state._persistenceRevision + 1,
    }));
  },
}));
