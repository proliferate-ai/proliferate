import { create } from "zustand";

export const CHAT_DIFF_PREFERENCES_STORAGE_KEY = "proliferate.chatDiffPreferences.v1";

interface ChatDiffPreferencesState {
  wrapLongLines: boolean;
  setWrapLongLines: (wrapLongLines: boolean) => void;
  toggleWrapLongLines: () => void;
}

export const useChatDiffPreferencesStore = create<ChatDiffPreferencesState>((set, get) => ({
  wrapLongLines: readPersistedWrapLongLines(),

  setWrapLongLines: (wrapLongLines) => {
    set({ wrapLongLines });
    writePersistedWrapLongLines(wrapLongLines);
  },

  toggleWrapLongLines: () => {
    const wrapLongLines = !get().wrapLongLines;
    set({ wrapLongLines });
    writePersistedWrapLongLines(wrapLongLines);
  },
}));

function readPersistedWrapLongLines(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const raw = window.localStorage.getItem(CHAT_DIFF_PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return false;
    }

    const parsed: unknown = JSON.parse(raw);
    if (
      parsed
      && typeof parsed === "object"
      && "wrapLongLines" in parsed
      && typeof parsed.wrapLongLines === "boolean"
    ) {
      return parsed.wrapLongLines;
    }
  } catch {
    return false;
  }

  return false;
}

function writePersistedWrapLongLines(wrapLongLines: boolean): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      CHAT_DIFF_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ wrapLongLines }),
    );
  } catch {
    // Browser storage can be unavailable in tests, privacy modes, or SSR-like previews.
  }
}
