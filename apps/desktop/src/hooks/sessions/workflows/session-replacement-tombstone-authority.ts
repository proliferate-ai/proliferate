export interface SessionReplacementTombstoneAuthoritySnapshot {
  hydrated: boolean;
  revision: number;
}

let snapshot: SessionReplacementTombstoneAuthoritySnapshot = {
  hydrated: false,
  revision: 0,
};
let authorityKey: object | null = null;
let lifecycleGeneration = 0;
const listeners = new Set<() => void>();
const hydrationWaiters = new Set<() => void>();

export interface SessionReplacementTombstoneHydrationGeneration {
  lifecycleGeneration: number;
  revision: number;
}

export function beginSessionReplacementTombstoneHydration(
  key: object,
): SessionReplacementTombstoneHydrationGeneration {
  lifecycleGeneration += 1;
  authorityKey = key;
  snapshot = { ...snapshot, hydrated: false };
  publish();
  return { lifecycleGeneration, revision: snapshot.revision };
}

export function endSessionReplacementTombstoneHydration(
  key: object,
  expectedLifecycleGeneration: number,
): void {
  if (!isCurrentSessionReplacementTombstoneHydration(
    key,
    expectedLifecycleGeneration,
  )) return;
  authorityKey = null;
  snapshot = { ...snapshot, hydrated: false };
  publish();
}

export function isSessionReplacementTombstoneAuthorityCurrent(key: object): boolean {
  return authorityKey === key;
}

export function isCurrentSessionReplacementTombstoneHydration(
  key: object,
  expectedLifecycleGeneration: number,
): boolean {
  return authorityKey === key && lifecycleGeneration === expectedLifecycleGeneration;
}

export function advanceSessionReplacementTombstoneRevision(): void {
  snapshot = { ...snapshot, revision: snapshot.revision + 1 };
  publish();
}

export function settleSessionReplacementTombstoneHydration(
  stateChanged: boolean,
): void {
  snapshot = {
    hydrated: true,
    revision: snapshot.revision + (stateChanged ? 1 : 0),
  };
  publish();
  for (const resolve of hydrationWaiters) resolve();
  hydrationWaiters.clear();
}

export function readSessionReplacementTombstoneAuthoritySnapshot() {
  return snapshot;
}

export function subscribeSessionReplacementTombstoneAuthority(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function waitForSessionReplacementTombstoneHydration(): Promise<void> {
  if (snapshot.hydrated) return Promise.resolve();
  return new Promise((resolve) => hydrationWaiters.add(resolve));
}

export function resetSessionReplacementTombstoneAuthorityForTests(): void {
  authorityKey = null;
  lifecycleGeneration += 1;
  snapshot = { hydrated: true, revision: snapshot.revision + 1 };
  publish();
  for (const resolve of hydrationWaiters) resolve();
  hydrationWaiters.clear();
}

function publish(): void {
  for (const listener of listeners) listener();
}
