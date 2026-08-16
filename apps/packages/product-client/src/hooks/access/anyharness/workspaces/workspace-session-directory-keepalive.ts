import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { QueryObserver } from "@tanstack/react-query";

/**
 * UX-latency R14: bounded keep-alive for the workspace session-directory query.
 *
 * MEASURED PROBLEM: the anyHarnessSessionsKey react-query entry is seeded with
 * setQueryData, loses its last observer the moment the user navigates away, and
 * is garbage-collected — so every revisit was a cold cache MISS (14 miss / 3 hit
 * live), each paying a full session-list network round trip on the
 * workspace-switch critical path.
 *
 * FIX: pin the last N visited workspace session queries with a disabled
 * QueryObserver. A query with at least one observer is never garbage-collected,
 * so an intra-run revisit finds the entry warm and getWorkspaceSessionsCacheDecision
 * truthfully reports "hit". The pin is DISABLED (enabled: false) so it never
 * fetches on its own — the bootstrap still owns fetching/revalidation. This is
 * NOT stale-tolerant SWR: the warm entry is served for first paint and the
 * bootstrap revalidates immediately (see loadWorkspaceSessions).
 *
 * MEMORY BOUND: an LRU of exactly MAX_WARM_WORKSPACE_SESSION_QUERIES pins. When a
 * new workspace is pinned past the bound, the least-recently-pinned observer is
 * destroyed, which drops its subscription and lets that query resume the normal
 * gcTime countdown — so at most N session-list payloads are retained.
 */

export const MAX_WARM_WORKSPACE_SESSION_QUERIES = 5;

interface WarmPin {
  observer: QueryObserver;
  unsubscribe: () => void;
}

// Insertion order in a Map is LRU order: re-pinning deletes+reinserts to move an
// entry to the most-recently-used end.
const warmPins = new Map<string, WarmPin>();

function pinCacheKey(queryKey: QueryKey): string {
  return JSON.stringify(queryKey);
}

function destroyPin(pin: WarmPin): void {
  pin.unsubscribe();
  pin.observer.destroy();
}

/**
 * Keep `queryKey` warm (not garbage-collected) as one of the most-recently
 * visited N workspace session queries. Idempotent per key; re-pinning refreshes
 * LRU recency without creating a second observer.
 */
export function pinWorkspaceSessionsQueryWarm(
  queryClient: QueryClient,
  queryKey: QueryKey,
): void {
  const cacheKey = pinCacheKey(queryKey);
  const existing = warmPins.get(cacheKey);
  if (existing) {
    warmPins.delete(cacheKey);
    warmPins.set(cacheKey, existing);
    return;
  }

  const observer = new QueryObserver(queryClient, {
    queryKey,
    // Never fetch from the pin itself; it exists only to retain the entry. The
    // bootstrap remains the single owner of fetching and revalidation.
    enabled: false,
    // Do not let the pin mark data stale or schedule background refetches.
    staleTime: Number.POSITIVE_INFINITY,
    notifyOnChangeProps: [],
  });
  const unsubscribe = observer.subscribe(() => {});
  warmPins.set(cacheKey, { observer, unsubscribe });

  while (warmPins.size > MAX_WARM_WORKSPACE_SESSION_QUERIES) {
    const oldestKey = warmPins.keys().next().value as string | undefined;
    if (oldestKey === undefined) {
      break;
    }
    const oldestPin = warmPins.get(oldestKey);
    warmPins.delete(oldestKey);
    if (oldestPin) {
      destroyPin(oldestPin);
    }
  }
}

export function resetWorkspaceSessionsWarmPinsForTest(): void {
  for (const pin of warmPins.values()) {
    destroyPin(pin);
  }
  warmPins.clear();
}

export function warmWorkspaceSessionsPinCountForTest(): number {
  return warmPins.size;
}
