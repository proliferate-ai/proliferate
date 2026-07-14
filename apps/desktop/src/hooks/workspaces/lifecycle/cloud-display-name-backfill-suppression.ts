import {
  readPersistedJson,
  removePersistedKey,
  writePersistedJson,
  type ProductStorageContext,
} from "@/lib/infra/persistence/product-storage";

const CLOUD_DISPLAY_NAME_BACKFILL_SUPPRESSION_KEY =
  "proliferate.cloudDisplayNameBackfillSuppression.v1";

type SuppressionMap = Record<string, true>;

// Read synchronously in a render/effect guard, so the authoritative copy is an
// in-memory cache. ProductStorage is the async persistence backend injected once
// at the product lifecycle mount (see `useCloudDisplayNameSuppressionPersistence`);
// hydration re-seeds the cache and writes persist best-effort.
let suppressionCache: SuppressionMap = {};
let storageContext: ProductStorageContext | null = null;

export function setCloudDisplayNameSuppressionStorageContext(
  context: ProductStorageContext | null,
): void {
  storageContext = context;
}

function normalizeSuppressionMap(raw: unknown): SuppressionMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  return raw as SuppressionMap;
}

function persistSuppressionMap(map: SuppressionMap): void {
  if (!storageContext) {
    return;
  }
  if (Object.keys(map).length === 0) {
    void removePersistedKey(storageContext, CLOUD_DISPLAY_NAME_BACKFILL_SUPPRESSION_KEY);
    return;
  }
  void writePersistedJson(storageContext, CLOUD_DISPLAY_NAME_BACKFILL_SUPPRESSION_KEY, map);
}

/**
 * One-shot hydration of the persisted suppression map through the injected
 * ProductStorage into the in-memory cache. A read resolving after unmount (via
 * `isStale`) is ignored.
 */
export async function hydrateCloudDisplayNameSuppression(
  context: ProductStorageContext,
  isStale?: () => boolean,
): Promise<void> {
  const result = await readPersistedJson<SuppressionMap>(
    context,
    CLOUD_DISPLAY_NAME_BACKFILL_SUPPRESSION_KEY,
    {
      parse: (raw) => normalizeSuppressionMap(raw),
      fallback: {},
      isStale,
    },
  );
  if (result.status !== "settled") {
    return;
  }
  // Preserve any suppressions written during the async hydration window.
  suppressionCache = { ...result.value, ...suppressionCache };
}

export function isCloudDisplayNameBackfillSuppressed(cloudWorkspaceId: string): boolean {
  return suppressionCache[cloudWorkspaceId] === true;
}

export function suppressCloudDisplayNameBackfill(cloudWorkspaceId: string): void {
  if (suppressionCache[cloudWorkspaceId] === true) {
    return;
  }
  suppressionCache = { ...suppressionCache, [cloudWorkspaceId]: true };
  persistSuppressionMap(suppressionCache);
}

export function clearCloudDisplayNameBackfillSuppression(cloudWorkspaceId: string): void {
  if (suppressionCache[cloudWorkspaceId] !== true) {
    return;
  }
  const next = { ...suppressionCache };
  delete next[cloudWorkspaceId];
  suppressionCache = next;
  persistSuppressionMap(suppressionCache);
}

export function resetCloudDisplayNameSuppressionForTests(): void {
  storageContext = null;
  suppressionCache = {};
}
