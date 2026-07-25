import { useEffect } from "react";

import { useProductStorageContext } from "@/hooks/app/facade/use-product-storage-context";
import {
  HOME_NEXT_TARGET_SELECTION_STORAGE_KEY,
  hydrateHomeNextTargetSelectionState,
  readHomeNextTargetSelectionRevision,
  readHomeNextTargetSelectionState,
  normalizeHomeNextTargetSelectionState,
  subscribeHomeNextTargetSelectionState,
  type HomeNextTargetSelectionState,
} from "@/hooks/home/ui/use-home-next-target-selection-state";
import {
  readProductStorageJson,
  writeProductStorageJson,
} from "@/lib/infra/persistence/product-storage";

export function useHomeNextTargetSelectionLifecycle(): void {
  const persistence = useProductStorageContext();

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const startingRevision = readHomeNextTargetSelectionRevision();

    const persistSnapshot = (state: HomeNextTargetSelectionState) => {
      const snapshot = cloneHomeNextTargetSelectionState(state);
      void writeProductStorageJson(
        persistence,
        HOME_NEXT_TARGET_SELECTION_STORAGE_KEY,
        snapshot,
      );
    };

    void readProductStorageJson(
      persistence,
      HOME_NEXT_TARGET_SELECTION_STORAGE_KEY,
    ).then((persisted) => {
      if (cancelled) return;

      const current = readHomeNextTargetSelectionState();
      const changedWhileReading = readHomeNextTargetSelectionRevision()
        !== startingRevision;
      const reconciled = changedWhileReading
        ? current
        : normalizeHomeNextTargetSelectionState(persisted);
      hydrateHomeNextTargetSelectionState(
        reconciled,
        readHomeNextTargetSelectionRevision(),
      );
      unsubscribe = subscribeHomeNextTargetSelectionState(() => {
        persistSnapshot(readHomeNextTargetSelectionState());
      });
      if (changedWhileReading) {
        persistSnapshot(reconciled);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [persistence]);
}

function cloneHomeNextTargetSelectionState(
  state: HomeNextTargetSelectionState,
): HomeNextTargetSelectionState {
  return {
    ...state,
    repositorySelection: { ...state.repositorySelection },
  };
}
