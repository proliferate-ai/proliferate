import { useEffect } from "react";

import { useProductStorageContext } from "@/hooks/app/facade/use-product-storage-context";
import {
  prepareSessionReplacementTombstonesForStorage,
  replaceSessionReplacementTombstonesFromPersistence,
} from "@/hooks/sessions/workflows/session-replacement-tombstone-durable-operations";
import {
  readSessionReplacementTombstones,
} from "@/lib/workflows/sessions/session-replacement-tombstones-persistence";
import {
  beginSessionReplacementTombstoneHydration,
  endSessionReplacementTombstoneHydration,
  isCurrentSessionReplacementTombstoneHydration,
  settleSessionReplacementTombstoneHydration,
} from "@/hooks/sessions/workflows/session-replacement-tombstone-authority";
export function useSessionReplacementTombstonesLifecycle(): void {
  const persistence = useProductStorageContext();

  useEffect(() => {
    let cancelled = false;
    const generation = beginSessionReplacementTombstoneHydration(persistence.storage);
    prepareSessionReplacementTombstonesForStorage(persistence.storage);
    const isCurrent = () => (
      !cancelled
      && isCurrentSessionReplacementTombstoneHydration(
        persistence.storage,
        generation.lifecycleGeneration,
      )
    );

    void readSessionReplacementTombstones(persistence).then((persisted) => {
      if (!isCurrent()) return;
      replaceSessionReplacementTombstonesFromPersistence(persisted, false);
      settleSessionReplacementTombstoneHydration(true);
    });

    return () => {
      cancelled = true;
      endSessionReplacementTombstoneHydration(
        persistence.storage,
        generation.lifecycleGeneration,
      );
    };
  }, [persistence]);
}
