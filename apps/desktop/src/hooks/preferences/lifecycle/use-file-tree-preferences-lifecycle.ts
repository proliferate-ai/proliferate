import { useEffect } from "react";

import { useProductStorageContext } from "@/hooks/app/facade/use-product-storage-context";
import {
  readProductStorageJson,
  writeProductStorageJson,
} from "@/lib/infra/persistence/product-storage";
import {
  FILE_TREE_DEFAULT_WIDTH,
  FILE_TREE_MIN_WIDTH,
  FILE_TREE_STORAGE_KEY,
  useFileTreeStore,
} from "@/stores/editor/file-tree-store";

interface PersistedFileTreePreferences {
  width?: unknown;
}

export function useFileTreePreferencesLifecycle(): void {
  const persistence = useProductStorageContext();

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const startingRevision = useFileTreeStore.getState()._persistenceRevision;
    const persistWidth = (width: number) => {
      void writeProductStorageJson(
        persistence,
        FILE_TREE_STORAGE_KEY,
        { width: Math.max(FILE_TREE_MIN_WIDTH, width) },
      );
    };
    void readProductStorageJson<PersistedFileTreePreferences>(
      persistence,
      FILE_TREE_STORAGE_KEY,
    ).then((persisted) => {
      if (cancelled) return;
      const current = useFileTreeStore.getState();
      const changedWhileReading = current._persistenceRevision !== startingRevision;
      current.hydrateWidth(
        changedWhileReading
          ? current.width
          : typeof persisted?.width === "number"
          ? persisted.width
          : FILE_TREE_DEFAULT_WIDTH,
      );
      if (changedWhileReading) {
        persistWidth(current.width);
      }
      unsubscribe = useFileTreeStore.subscribe((state, previous) => {
        if (
          !state._hydrated
          || !previous._hydrated
          || state.width === previous.width
        ) {
          return;
        }
        persistWidth(state.width);
      });
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [persistence]);
}
