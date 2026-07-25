import { useEffect } from "react";

import { useProductStorageContext } from "@/hooks/app/facade/use-product-storage-context";
import {
  readProductStorageJson,
  writeProductStorageJson,
} from "@/lib/infra/persistence/product-storage";
import {
  CHAT_DIFF_PREFERENCES_STORAGE_KEY,
  useChatDiffPreferencesStore,
} from "@/stores/chat/chat-diff-preferences-store";

interface PersistedChatDiffPreferences {
  wrapLongLines?: unknown;
}

export function useChatDiffPreferencesLifecycle(): void {
  const persistence = useProductStorageContext();

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const startingRevision = useChatDiffPreferencesStore.getState()._persistenceRevision;
    const persistWrapLongLines = (wrapLongLines: boolean) => {
      void writeProductStorageJson(
        persistence,
        CHAT_DIFF_PREFERENCES_STORAGE_KEY,
        { wrapLongLines },
      );
    };
    void readProductStorageJson<PersistedChatDiffPreferences>(
      persistence,
      CHAT_DIFF_PREFERENCES_STORAGE_KEY,
    ).then((persisted) => {
      if (cancelled) return;
      const current = useChatDiffPreferencesStore.getState();
      const changedWhileReading = current._persistenceRevision !== startingRevision;
      current.hydrate(
        changedWhileReading
          ? current.wrapLongLines
          : typeof persisted?.wrapLongLines === "boolean"
          ? persisted.wrapLongLines
          : false,
      );
      if (changedWhileReading) {
        persistWrapLongLines(current.wrapLongLines);
      }
      unsubscribe = useChatDiffPreferencesStore.subscribe((state, previous) => {
        if (
          !state._hydrated
          || !previous._hydrated
          || state.wrapLongLines === previous.wrapLongLines
        ) {
          return;
        }
        persistWrapLongLines(state.wrapLongLines);
      });
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [persistence]);
}
