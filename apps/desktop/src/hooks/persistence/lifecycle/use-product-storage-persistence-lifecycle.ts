import { useEffect } from "react";
import { useProductStorageContext } from "@/hooks/persistence/use-product-storage-context";
import {
  hydrateChatDiffPreferences,
  setChatDiffPreferencesStorageContext,
} from "@/stores/chat/chat-diff-preferences-store";
import {
  hydrateFileTreeStore,
  setFileTreeStoreStorageContext,
} from "@/stores/editor/file-tree-store";
import {
  hydrateHomeNextTargetSelection,
  setHomeNextTargetSelectionStorageContext,
} from "@/hooks/home/ui/use-home-next-target-selection-state";
import {
  hydrateCloudDisplayNameSuppression,
  setCloudDisplayNameSuppressionStorageContext,
} from "@/hooks/workspaces/lifecycle/cloud-display-name-backfill-suppression";
import {
  hydrateSessionReplacementTombstones,
  setSessionReplacementTombstonesStorageContext,
} from "@/lib/access/persistence/session-replacement-tombstones-storage";
import { hydrateCommittedReplacedSessionTombstones } from "@/hooks/sessions/workflows/session-replacement-tombstones";

/**
 * Wires the injected ProductStorage backend into the module-singleton product
 * stores (Zustand stores + external stores that cannot call hooks) and runs a
 * single hydration read for each. Reads that resolve after unmount/host
 * replacement are discarded via each hydrator's `isStale` guard, so a late read
 * never overwrites live state. Writes for these stores go through the wired
 * context; there is no store-subscription to leak, so StrictMode's double-invoke
 * only re-runs the idempotent wiring and an idempotent hydration read.
 *
 * Hook-owned surfaces (model-probe dismissal, support-report queue,
 * organization-join target) take the context directly and are not wired here.
 */
export function useProductStoragePersistenceLifecycle(): void {
  const storage = useProductStorageContext();

  useEffect(() => {
    let cancelled = false;
    const isStale = () => cancelled;

    setChatDiffPreferencesStorageContext(storage);
    void hydrateChatDiffPreferences(storage, isStale);

    setFileTreeStoreStorageContext(storage);
    void hydrateFileTreeStore(storage, isStale);

    setHomeNextTargetSelectionStorageContext(storage);
    void hydrateHomeNextTargetSelection(storage, isStale);

    setCloudDisplayNameSuppressionStorageContext(storage);
    void hydrateCloudDisplayNameSuppression(storage, isStale);

    setSessionReplacementTombstonesStorageContext(storage);
    void hydrateSessionReplacementTombstones(storage, isStale).then((entries) => {
      if (!cancelled) {
        hydrateCommittedReplacedSessionTombstones(entries);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [storage]);
}
