import { create } from "zustand";
import {
  readPersistedJson,
  writePersistedJson,
  type ProductStorageContext,
} from "@/lib/infra/persistence/product-storage";

export const CHAT_DIFF_PREFERENCES_STORAGE_KEY = "proliferate.chatDiffPreferences.v1";

interface ChatDiffPreferencesState {
  wrapLongLines: boolean;
  setWrapLongLines: (wrapLongLines: boolean) => void;
  toggleWrapLongLines: () => void;
}

// This store is a module singleton, so it cannot call `useProductHost()`. Its
// persistence backend is injected once at the product lifecycle mount (see
// `useChatDiffPreferencesPersistence`). Until then writes are in-memory only and
// hydration re-seeds the persisted value; the public store API is unchanged.
let storageContext: ProductStorageContext | null = null;
let hasUserWritten = false;

export function setChatDiffPreferencesStorageContext(
  context: ProductStorageContext | null,
): void {
  storageContext = context;
}

export const useChatDiffPreferencesStore = create<ChatDiffPreferencesState>((set, get) => ({
  wrapLongLines: false,

  setWrapLongLines: (wrapLongLines) => {
    hasUserWritten = true;
    set({ wrapLongLines });
    persistWrapLongLines(wrapLongLines);
  },

  toggleWrapLongLines: () => {
    hasUserWritten = true;
    const wrapLongLines = !get().wrapLongLines;
    set({ wrapLongLines });
    persistWrapLongLines(wrapLongLines);
  },
}));

function persistWrapLongLines(wrapLongLines: boolean): void {
  if (!storageContext) {
    return;
  }
  void writePersistedJson(storageContext, CHAT_DIFF_PREFERENCES_STORAGE_KEY, {
    wrapLongLines,
  });
}

/**
 * One-shot hydration of the persisted wrap-long-lines preference through the
 * injected ProductStorage. A read that resolves after the user already toggled
 * (or after unmount, via `isStale`) is ignored so a late read never overwrites
 * live state.
 */
export async function hydrateChatDiffPreferences(
  context: ProductStorageContext,
  isStale?: () => boolean,
): Promise<void> {
  const result = await readPersistedJson<boolean>(
    context,
    CHAT_DIFF_PREFERENCES_STORAGE_KEY,
    {
      parse: (raw) =>
        raw
        && typeof raw === "object"
        && "wrapLongLines" in raw
        && typeof (raw as { wrapLongLines: unknown }).wrapLongLines === "boolean"
          ? (raw as { wrapLongLines: boolean }).wrapLongLines
          : false,
      fallback: false,
      isStale,
    },
  );
  if (result.status !== "settled" || hasUserWritten) {
    return;
  }
  useChatDiffPreferencesStore.setState({ wrapLongLines: result.value });
}

export function resetChatDiffPreferencesForTests(): void {
  storageContext = null;
  hasUserWritten = false;
  useChatDiffPreferencesStore.setState({ wrapLongLines: false });
}
