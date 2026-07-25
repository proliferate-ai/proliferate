import { useEffect, useMemo, useSyncExternalStore } from "react";

import { useProductStorageContext } from "@/hooks/app/facade/use-product-storage-context";
import {
  readProductStorageJson,
  removeProductStorageItem,
  writeProductStorageJson,
  type ProductStorageContext,
} from "@/lib/infra/persistence/product-storage";

const CLOUD_DISPLAY_NAME_BACKFILL_SUPPRESSION_KEY =
  "proliferate.cloudDisplayNameBackfillSuppression.v1";

type SuppressionMap = Record<string, true>;

let suppressionMap: SuppressionMap = {};
let suppressionRevision = 0;
let suppressionHydrated = false;
let suppressionAuthorityStorage: ProductStorageContext["storage"] | null = null;
let suppressionLifecycleGeneration = 0;
let suppressionAuthoritySnapshot = {
  hydrated: suppressionHydrated,
  revision: suppressionRevision,
};
const suppressionListeners = new Set<() => void>();

function normalizeSuppressionMap(value: unknown): SuppressionMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, true] => (
      entry[1] === true
    )),
  );
}

export function useCloudDisplayNameBackfillSuppressionAuthority() {
  const persistence = useProductStorageContext();
  const authority = useSyncExternalStore(
    subscribeSuppressionChanges,
    readSuppressionAuthoritySnapshot,
    readSuppressionAuthoritySnapshot,
  );
  return useMemo(() => (
    suppressionAuthorityStorage === persistence.storage
      ? authority
      : { hydrated: false, revision: authority.revision }
  ), [authority, persistence.storage]);
}

export function isCloudDisplayNameBackfillSuppressed(
  cloudWorkspaceId: string,
): boolean {
  return suppressionMap[cloudWorkspaceId] === true;
}

export function suppressCloudDisplayNameBackfill(cloudWorkspaceId: string): void {
  if (suppressionMap[cloudWorkspaceId] === true) return;
  replaceSuppressionMap({
    ...suppressionMap,
    [cloudWorkspaceId]: true,
  });
}

export function clearCloudDisplayNameBackfillSuppression(
  cloudWorkspaceId: string,
): void {
  const isHydrating = !suppressionHydrated && suppressionAuthorityStorage !== null;
  if (suppressionMap[cloudWorkspaceId] !== true && !isHydrating) return;

  const next = { ...suppressionMap };
  delete next[cloudWorkspaceId];
  replaceSuppressionMap(next);
}

export function resetCloudDisplayNameBackfillSuppressionForTests(): void {
  suppressionMap = {};
  suppressionRevision += 1;
  suppressionHydrated = false;
  suppressionAuthorityStorage = null;
  suppressionLifecycleGeneration += 1;
  publishSuppressionAuthority();
}

export function useCloudDisplayNameBackfillSuppressionLifecycle(): void {
  const persistence = useProductStorageContext();

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const lifecycleGeneration = beginSuppressionHydration(persistence.storage);
    const startingRevision = suppressionRevision;
    void readProductStorageJson<SuppressionMap>(
      persistence,
      CLOUD_DISPLAY_NAME_BACKFILL_SUPPRESSION_KEY,
    ).then((persistedValue) => {
      if (
        cancelled
        || !isCurrentSuppressionLifecycle(persistence.storage, lifecycleGeneration)
      ) return;

      const liveStateWon = suppressionRevision !== startingRevision;
      if (!liveStateWon) {
        replaceSuppressionMap(normalizeSuppressionMap(persistedValue));
      }
      suppressionHydrated = true;
      publishSuppressionAuthority();
      unsubscribe = subscribeSuppressionChanges(() => {
        persistSuppressionSnapshot(persistence, suppressionMap);
      });
      if (liveStateWon) {
        persistSuppressionSnapshot(persistence, suppressionMap);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
      endSuppressionHydration(persistence.storage, lifecycleGeneration);
    };
  }, [persistence]);
}

function beginSuppressionHydration(
  storage: ProductStorageContext["storage"],
): number {
  suppressionLifecycleGeneration += 1;
  suppressionAuthorityStorage = storage;
  suppressionHydrated = false;
  publishSuppressionAuthority();
  return suppressionLifecycleGeneration;
}

function endSuppressionHydration(
  storage: ProductStorageContext["storage"],
  lifecycleGeneration: number,
): void {
  if (!isCurrentSuppressionLifecycle(storage, lifecycleGeneration)) return;
  suppressionAuthorityStorage = null;
  suppressionHydrated = false;
  publishSuppressionAuthority();
}

function isCurrentSuppressionLifecycle(
  storage: ProductStorageContext["storage"],
  lifecycleGeneration: number,
): boolean {
  return suppressionAuthorityStorage === storage
    && suppressionLifecycleGeneration === lifecycleGeneration;
}

function persistSuppressionSnapshot(
  persistence: ProductStorageContext,
  current: SuppressionMap,
): void {
  const snapshot = { ...current };
  if (Object.keys(snapshot).length === 0) {
    void removeProductStorageItem(
      persistence,
      CLOUD_DISPLAY_NAME_BACKFILL_SUPPRESSION_KEY,
    );
    return;
  }
  void writeProductStorageJson(
    persistence,
    CLOUD_DISPLAY_NAME_BACKFILL_SUPPRESSION_KEY,
    snapshot,
  );
}

function subscribeSuppressionChanges(listener: () => void): () => void {
  suppressionListeners.add(listener);
  return () => suppressionListeners.delete(listener);
}

function readSuppressionAuthoritySnapshot() {
  return suppressionAuthoritySnapshot;
}

function publishSuppressionAuthority(): void {
  suppressionAuthoritySnapshot = {
    hydrated: suppressionHydrated,
    revision: suppressionRevision,
  };
  for (const listener of suppressionListeners) listener();
}

function replaceSuppressionMap(next: SuppressionMap): void {
  suppressionMap = next;
  suppressionRevision += 1;
  publishSuppressionAuthority();
}
