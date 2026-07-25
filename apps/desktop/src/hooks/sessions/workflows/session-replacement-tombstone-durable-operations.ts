import type { ProductStorageContext } from "@/lib/infra/persistence/product-storage";
import type {
  PersistedSessionReplacementTombstones,
} from "@/lib/workflows/sessions/session-replacement-tombstones-persistence";
import {
  writeSessionReplacementTombstones,
} from "@/lib/workflows/sessions/session-replacement-tombstones-persistence";
import {
  addSuppressedSessionIds,
  cloneTombstoneSource,
  createTombstoneEntry,
  removeTombstoneEntry,
  replaceTombstoneSource,
} from "@/hooks/sessions/workflows/session-replacement-tombstone-collections";
import {
  advanceSessionReplacementTombstoneRevision,
  isSessionReplacementTombstoneAuthorityCurrent,
  readSessionReplacementTombstoneAuthoritySnapshot,
  resetSessionReplacementTombstoneAuthorityForTests,
} from "@/hooks/sessions/workflows/session-replacement-tombstone-authority";
import {
  sessionReplacementTombstoneState,
} from "@/hooks/sessions/workflows/session-replacement-tombstone-state";
import {
  sessionReplacementTombstoneSourceFromSnapshot,
  snapshotSessionReplacementTombstoneSource,
} from "@/hooks/sessions/workflows/session-replacement-tombstone-snapshots";

export async function commitReplacedSessionTombstone(
  persistence: ProductStorageContext,
  workspaceId: string,
  runtimeSessionId: string,
  suppressedSessionIds: readonly string[] = [runtimeSessionId],
): Promise<boolean> {
  if (!isPersistenceContextCurrent(persistence)) return false;
  const stagedEntry = sessionReplacementTombstoneState.stagedByWorkspaceId
    .get(workspaceId)?.get(runtimeSessionId);
  const existing = sessionReplacementTombstoneState.committedByWorkspaceId
    .get(workspaceId)?.get(runtimeSessionId);
  const requestedIds = new Set([
    runtimeSessionId,
    ...suppressedSessionIds,
    ...(stagedEntry?.suppressedSessionIds ?? []),
  ]);
  if (
    existing
    && [...requestedIds].every((sessionId) => existing.suppressedSessionIds.has(sessionId))
  ) {
    removeTombstoneEntry(
      sessionReplacementTombstoneState.stagedByWorkspaceId,
      workspaceId,
      runtimeSessionId,
    );
    return true;
  }

  const commitGeneration = sessionReplacementTombstoneState.latestCommittedGeneration + 1;
  const nextCommitted = cloneTombstoneSource(
    sessionReplacementTombstoneState.committedByWorkspaceId,
  );
  const workspace = nextCommitted.get(workspaceId) ?? new Map();
  const committedEntry = workspace.get(runtimeSessionId)
    ?? createTombstoneEntry(runtimeSessionId, suppressedSessionIds);
  addSuppressedSessionIds(committedEntry, [...requestedIds]);
  committedEntry.committedGeneration = commitGeneration;
  workspace.set(runtimeSessionId, committedEntry);
  nextCommitted.set(workspaceId, workspace);

  return persistCandidate(persistence, nextCommitted, () => {
    removeTombstoneEntry(
      sessionReplacementTombstoneState.stagedByWorkspaceId,
      workspaceId,
      runtimeSessionId,
    );
    replaceTombstoneSource(
      sessionReplacementTombstoneState.committedByWorkspaceId,
      nextCommitted,
    );
    sessionReplacementTombstoneState.latestCommittedGeneration = commitGeneration;
    notifyCommittedStateChanged();
  });
}

/** Clear after an authoritative session list no longer contains the runtime id. */
export async function clearReplacedSessionTombstone(
  persistence: ProductStorageContext,
  workspaceId: string,
  runtimeSessionId: string,
): Promise<boolean> {
  const committedEntry = sessionReplacementTombstoneState.committedByWorkspaceId
    .get(workspaceId)?.get(runtimeSessionId);
  if (!committedEntry) {
    removeTombstoneEntry(
      sessionReplacementTombstoneState.stagedByWorkspaceId,
      workspaceId,
      runtimeSessionId,
    );
    return true;
  }
  if (!isPersistenceContextCurrent(persistence)) return false;
  const nextCommitted = cloneTombstoneSource(
    sessionReplacementTombstoneState.committedByWorkspaceId,
  );
  removeTombstoneEntry(nextCommitted, workspaceId, runtimeSessionId);
  return persistCandidate(persistence, nextCommitted, () => {
    const retired = sessionReplacementTombstoneState.retiredSuppressionByWorkspaceId
      .get(workspaceId) ?? new Map();
    retired.set(runtimeSessionId, committedEntry);
    sessionReplacementTombstoneState.retiredSuppressionByWorkspaceId
      .set(workspaceId, retired);
    removeTombstoneEntry(
      sessionReplacementTombstoneState.stagedByWorkspaceId,
      workspaceId,
      runtimeSessionId,
    );
    replaceTombstoneSource(
      sessionReplacementTombstoneState.committedByWorkspaceId,
      nextCommitted,
    );
    notifyCommittedStateChanged();
  });
}

/** Snapshot used to reject list responses that began before a tombstone commit. */
export function captureReplacedSessionTombstoneGeneration(): number {
  return sessionReplacementTombstoneState.latestCommittedGeneration;
}

export async function clearReplacedSessionTombstoneFromAuthoritativeList(
  persistence: ProductStorageContext,
  workspaceId: string,
  runtimeSessionId: string,
  requestStartGeneration: number,
): Promise<boolean> {
  const committedEntry = sessionReplacementTombstoneState.committedByWorkspaceId
    .get(workspaceId)?.get(runtimeSessionId);
  if (committedEntry && committedEntry.committedGeneration > requestStartGeneration) {
    return false;
  }
  return clearReplacedSessionTombstone(
    persistence,
    workspaceId,
    runtimeSessionId,
  );
}

export function committedReplacedSessionTombstonesForWorkspace(
  workspaceId: string,
): string[] {
  return [
    ...(sessionReplacementTombstoneState.committedByWorkspaceId
      .get(workspaceId)?.keys() ?? []),
  ];
}

export function canPersistReplacedSessionTombstones(): boolean {
  return readSessionReplacementTombstoneAuthoritySnapshot().hydrated;
}

export async function releaseReplacedSessionSuppression(
  persistence: ProductStorageContext,
  workspaceId: string,
  runtimeSessionId: string,
): Promise<boolean> {
  if (!sessionReplacementTombstoneState.committedByWorkspaceId
    .get(workspaceId)?.has(runtimeSessionId)) {
    clearRendererSessionReplacementSuppression(workspaceId, runtimeSessionId);
    return true;
  }
  if (!isPersistenceContextCurrent(persistence)) return false;
  const nextCommitted = cloneTombstoneSource(
    sessionReplacementTombstoneState.committedByWorkspaceId,
  );
  removeTombstoneEntry(nextCommitted, workspaceId, runtimeSessionId);
  return persistCandidate(persistence, nextCommitted, () => {
    replaceTombstoneSource(
      sessionReplacementTombstoneState.committedByWorkspaceId,
      nextCommitted,
    );
    clearRendererSessionReplacementSuppression(workspaceId, runtimeSessionId);
    notifyCommittedStateChanged();
  });
}

export function resetReplacedSessionTombstonesForTests(): void {
  sessionReplacementTombstoneState.committedStorageKey = null;
  sessionReplacementTombstoneState.stagedByWorkspaceId.clear();
  sessionReplacementTombstoneState.stagedClientAliasesByWorkspaceId.clear();
  sessionReplacementTombstoneState.committedByWorkspaceId.clear();
  sessionReplacementTombstoneState.retiredSuppressionByWorkspaceId.clear();
  sessionReplacementTombstoneState.retiredClientAliasesByWorkspaceId.clear();
  sessionReplacementTombstoneState.latestCommittedGeneration = 0;
  resetSessionReplacementTombstoneAuthorityForTests();
}

export function readSessionReplacementTombstonesRevision(): number {
  return readSessionReplacementTombstoneAuthoritySnapshot().revision;
}

export function prepareSessionReplacementTombstonesForStorage(
  storage: object,
): void {
  if (sessionReplacementTombstoneState.committedStorageKey === storage) return;
  sessionReplacementTombstoneState.committedStorageKey = storage;
  sessionReplacementTombstoneState.stagedByWorkspaceId.clear();
  sessionReplacementTombstoneState.stagedClientAliasesByWorkspaceId.clear();
  sessionReplacementTombstoneState.committedByWorkspaceId.clear();
  sessionReplacementTombstoneState.retiredSuppressionByWorkspaceId.clear();
  sessionReplacementTombstoneState.retiredClientAliasesByWorkspaceId.clear();
  advanceSessionReplacementTombstoneRevision();
}

export function replaceSessionReplacementTombstonesFromPersistence(
  persisted: PersistedSessionReplacementTombstones,
  publish: boolean,
): void {
  replaceTombstoneSource(
    sessionReplacementTombstoneState.committedByWorkspaceId,
    sessionReplacementTombstoneSourceFromSnapshot(persisted),
  );
  if (publish) notifyCommittedStateChanged();
}

export function snapshotSessionReplacementTombstones(): PersistedSessionReplacementTombstones {
  return snapshotSessionReplacementTombstoneSource(
    sessionReplacementTombstoneState.committedByWorkspaceId,
  );
}

async function persistCandidate(
  persistence: ProductStorageContext,
  nextCommitted: typeof sessionReplacementTombstoneState.committedByWorkspaceId,
  promote: () => void,
): Promise<boolean> {
  const written = await writeSessionReplacementTombstones(
    persistence,
    snapshotSessionReplacementTombstoneSource(nextCommitted),
  );
  if (!written || !isPersistenceContextCurrent(persistence)) return false;
  promote();
  return true;
}

function isPersistenceContextCurrent(persistence: ProductStorageContext): boolean {
  return sessionReplacementTombstoneState.committedStorageKey === persistence.storage
    && isSessionReplacementTombstoneAuthorityCurrent(persistence.storage)
    && readSessionReplacementTombstoneAuthoritySnapshot().hydrated;
}

function notifyCommittedStateChanged(): void {
  advanceSessionReplacementTombstoneRevision();
}

function clearRendererSessionReplacementSuppression(
  workspaceId: string,
  runtimeSessionId: string,
): void {
  removeTombstoneEntry(
    sessionReplacementTombstoneState.stagedByWorkspaceId,
    workspaceId,
    runtimeSessionId,
  );
  removeTombstoneEntry(
    sessionReplacementTombstoneState.retiredSuppressionByWorkspaceId,
    workspaceId,
    runtimeSessionId,
  );
  removeClientAlias(
    sessionReplacementTombstoneState.stagedClientAliasesByWorkspaceId,
    workspaceId,
    runtimeSessionId,
  );
  removeClientAlias(
    sessionReplacementTombstoneState.retiredClientAliasesByWorkspaceId,
    workspaceId,
    runtimeSessionId,
  );
}

function removeClientAlias(
  source: Map<string, Set<string>>,
  workspaceId: string,
  sessionId: string,
): void {
  const aliases = source.get(workspaceId);
  aliases?.delete(sessionId);
  if (aliases?.size === 0) source.delete(workspaceId);
}
