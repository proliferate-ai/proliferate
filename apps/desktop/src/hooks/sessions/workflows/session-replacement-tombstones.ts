import {
  type PersistedSessionReplacementTombstones,
  writeSessionReplacementTombstones,
} from "@/lib/access/persistence/session-replacement-tombstones-storage";

type SessionIdentity = { id: string };

interface TombstoneEntry {
  runtimeSessionId: string;
  suppressedSessionIds: Set<string>;
  committedGeneration: number;
}

type WorkspaceTombstones = Map<string, TombstoneEntry>;

// Renderer-scoped staged entries are deliberately memory-only. If the app exits before the
// replacement succeeds, the old runtime remains authoritative and reappears on
// restart. Only committed cleanup is persisted and eligible for dismissal.
const stagedByWorkspaceId = new Map<string, WorkspaceTombstones>();
// An in-flight client session may be replaced before it has a runtime id. Keep
// that alias out of optimistic/header projections without inventing a fake
// runtime tombstone that background cleanup could try to dismiss.
const stagedClientAliasesByWorkspaceId = new Map<string, Set<string>>();
// Seeded empty; restored via hydrateCommittedReplacedSessionTombstones once
// ProductStorage is wired (the backend read is async, unlike the old sync read).
const committedByWorkspaceId = new Map<string, WorkspaceTombstones>();
// Authoritative omission removes persistence, but suppression remains for the
// lifetime of this renderer. That prevents a slower pre-dismiss list response
// from arriving after the omission and repopulating the retired id. A cold
// renderer has no such in-flight requests, so this history need not persist.
const retiredSuppressionByWorkspaceId = new Map<string, WorkspaceTombstones>();
const retiredClientAliasesByWorkspaceId = new Map<string, Set<string>>();
let latestCommittedGeneration = 0;

export function stageReplacedClientSessionAlias(
  workspaceId: string,
  sessionId: string,
): boolean {
  const aliases = stagedClientAliasesByWorkspaceId.get(workspaceId) ?? new Set<string>();
  const sizeBefore = aliases.size;
  aliases.add(sessionId);
  stagedClientAliasesByWorkspaceId.set(workspaceId, aliases);
  return aliases.size !== sizeBefore;
}

export function retireStagedReplacedClientSessionAlias(
  workspaceId: string,
  sessionId: string,
): void {
  removeClientAlias(stagedClientAliasesByWorkspaceId, workspaceId, sessionId);
  const aliases = retiredClientAliasesByWorkspaceId.get(workspaceId) ?? new Set<string>();
  aliases.add(sessionId);
  retiredClientAliasesByWorkspaceId.set(workspaceId, aliases);
}

export function clearStagedReplacedClientSessionAlias(
  workspaceId: string,
  sessionId: string,
): void {
  removeClientAlias(stagedClientAliasesByWorkspaceId, workspaceId, sessionId);
}

export function stageReplacedSessionTombstone(
  workspaceId: string,
  runtimeSessionId: string,
  suppressedSessionIds: readonly string[] = [runtimeSessionId],
): boolean {
  if (committedByWorkspaceId.get(workspaceId)?.has(runtimeSessionId)) {
    return false;
  }
  const workspace = stagedByWorkspaceId.get(workspaceId) ?? new Map();
  const existing = workspace.get(runtimeSessionId);
  if (existing) {
    addSuppressedIds(existing, suppressedSessionIds);
    return false;
  }
  workspace.set(runtimeSessionId, createEntry(runtimeSessionId, suppressedSessionIds));
  stagedByWorkspaceId.set(workspaceId, workspace);
  return true;
}

export function commitReplacedSessionTombstone(
  workspaceId: string,
  runtimeSessionId: string,
  suppressedSessionIds: readonly string[] = [runtimeSessionId],
): boolean {
  const commitGeneration = latestCommittedGeneration + 1;
  const stagedEntry = stagedByWorkspaceId.get(workspaceId)?.get(runtimeSessionId);
  const nextCommitted = cloneTombstoneSource(committedByWorkspaceId);
  const workspace = nextCommitted.get(workspaceId) ?? new Map();
  const committedEntry = workspace.get(runtimeSessionId)
    ?? createEntry(runtimeSessionId, suppressedSessionIds);
  addSuppressedIds(committedEntry, suppressedSessionIds);
  if (stagedEntry) {
    addSuppressedIds(committedEntry, [...stagedEntry.suppressedSessionIds]);
  }
  committedEntry.committedGeneration = commitGeneration;
  workspace.set(runtimeSessionId, committedEntry);
  nextCommitted.set(workspaceId, workspace);
  if (!persistCommittedTombstones(nextCommitted)) {
    return false;
  }
  removeEntry(stagedByWorkspaceId, workspaceId, runtimeSessionId);
  replaceTombstoneSource(committedByWorkspaceId, nextCommitted);
  latestCommittedGeneration = commitGeneration;
  return true;
}

export function clearStagedReplacedSessionTombstone(
  workspaceId: string,
  runtimeSessionId: string,
): void {
  removeEntry(stagedByWorkspaceId, workspaceId, runtimeSessionId);
}

/** Runtime absence is confirmed, but stale in-flight lists still need a renderer fence. */
export function retireStagedReplacedSessionTombstone(
  workspaceId: string,
  runtimeSessionId: string,
): void {
  const stagedEntry = stagedByWorkspaceId.get(workspaceId)?.get(runtimeSessionId);
  if (stagedEntry) {
    const retired = retiredSuppressionByWorkspaceId.get(workspaceId) ?? new Map();
    retired.set(runtimeSessionId, stagedEntry);
    retiredSuppressionByWorkspaceId.set(workspaceId, retired);
  }
  removeEntry(stagedByWorkspaceId, workspaceId, runtimeSessionId);
}

/** Clear after an authoritative session list no longer contains the runtime id. */
export function clearReplacedSessionTombstone(
  workspaceId: string,
  runtimeSessionId: string,
): boolean {
  const committedEntry = committedByWorkspaceId.get(workspaceId)?.get(runtimeSessionId);
  if (!committedEntry) {
    removeEntry(stagedByWorkspaceId, workspaceId, runtimeSessionId);
    return true;
  }
  const nextCommitted = cloneTombstoneSource(committedByWorkspaceId);
  removeEntry(nextCommitted, workspaceId, runtimeSessionId);
  if (!persistCommittedTombstones(nextCommitted)) {
    return false;
  }
  const retired = retiredSuppressionByWorkspaceId.get(workspaceId) ?? new Map();
  retired.set(runtimeSessionId, committedEntry);
  retiredSuppressionByWorkspaceId.set(workspaceId, retired);
  removeEntry(stagedByWorkspaceId, workspaceId, runtimeSessionId);
  replaceTombstoneSource(committedByWorkspaceId, nextCommitted);
  return true;
}

/** Snapshot used to reject list responses that began before a tombstone commit. */
export function captureReplacedSessionTombstoneGeneration(): number {
  return latestCommittedGeneration;
}

/**
 * Clears cleanup state only when it existed before the authoritative list
 * request began. A list started before runtime creation can legitimately omit
 * that runtime and must not erase its newer durable retirement fence.
 */
export function clearReplacedSessionTombstoneFromAuthoritativeList(
  workspaceId: string,
  runtimeSessionId: string,
  requestStartGeneration: number,
): boolean {
  const committedEntry = committedByWorkspaceId.get(workspaceId)?.get(runtimeSessionId);
  if (committedEntry && committedEntry.committedGeneration > requestStartGeneration) {
    return false;
  }
  return clearReplacedSessionTombstone(workspaceId, runtimeSessionId);
}

export function isReplacedSessionTombstoned(
  workspaceId: string,
  sessionId: string,
): boolean {
  return suppressedIdsForWorkspace(workspaceId).has(sessionId);
}

export function isReplacedSessionTombstonedInAnyWorkspace(
  sessionId: string,
): boolean {
  for (const workspaceId of allWorkspaceIds()) {
    if (isReplacedSessionTombstoned(workspaceId, sessionId)) {
      return true;
    }
  }
  return false;
}

export function filterReplacedSessionTombstones<T extends SessionIdentity>(
  workspaceId: string,
  sessions: readonly T[] | undefined,
): T[] | undefined {
  if (!sessions) {
    return undefined;
  }
  const suppressedIds = suppressedIdsForWorkspace(workspaceId);
  return suppressedIds.size === 0
    ? [...sessions]
    : sessions.filter((session) => !suppressedIds.has(session.id));
}

export function filterReplacedSessionIds(
  workspaceId: string,
  sessionIds: readonly string[],
): string[] {
  const suppressedIds = suppressedIdsForWorkspace(workspaceId);
  return suppressedIds.size === 0
    ? [...sessionIds]
    : sessionIds.filter((sessionId) => !suppressedIds.has(sessionId));
}

/** Runtime ids whose replacement committed and may be retried for dismissal. */
export function committedReplacedSessionTombstonesForWorkspace(
  workspaceId: string,
): string[] {
  return [...(committedByWorkspaceId.get(workspaceId)?.keys() ?? [])];
}

export function canPersistReplacedSessionTombstones(): boolean {
  return persistCommittedTombstones();
}

export function hasStagedReplacedSessionTombstonesForWorkspace(
  workspaceId: string,
): boolean {
  return (stagedByWorkspaceId.get(workspaceId)?.size ?? 0) > 0
    || (stagedClientAliasesByWorkspaceId.get(workspaceId)?.size ?? 0) > 0;
}

export function shouldPreserveStagedReplacementShell(
  workspaceId: string,
  activeSessionWorkspaceId: string | null | undefined,
): boolean {
  return activeSessionWorkspaceId === workspaceId
    && hasStagedReplacedSessionTombstonesForWorkspace(workspaceId);
}

/** Explicit user restore overrides cleanup and releases runtime plus client aliases. */
export function releaseReplacedSessionSuppression(
  workspaceId: string,
  runtimeSessionId: string,
): boolean {
  if (committedByWorkspaceId.get(workspaceId)?.has(runtimeSessionId)) {
    const nextCommitted = cloneTombstoneSource(committedByWorkspaceId);
    removeEntry(nextCommitted, workspaceId, runtimeSessionId);
    if (!persistCommittedTombstones(nextCommitted)) {
      return false;
    }
    replaceTombstoneSource(committedByWorkspaceId, nextCommitted);
  }
  removeEntry(stagedByWorkspaceId, workspaceId, runtimeSessionId);
  removeEntry(retiredSuppressionByWorkspaceId, workspaceId, runtimeSessionId);
  removeClientAlias(stagedClientAliasesByWorkspaceId, workspaceId, runtimeSessionId);
  removeClientAlias(retiredClientAliasesByWorkspaceId, workspaceId, runtimeSessionId);
  return true;
}

// Restore async-hydrated committed tombstones without persisting back;
// in-session commits and retired ids win so a slow hydration cannot clobber
// newer state or resurrect a retired id.
export function hydrateCommittedReplacedSessionTombstones(
  entries: PersistedSessionReplacementTombstones,
): void {
  for (const [workspaceId, tombstones] of Object.entries(entries)) {
    const existing = committedByWorkspaceId.get(workspaceId) ?? new Map();
    const retired = retiredSuppressionByWorkspaceId.get(workspaceId);
    for (const entry of tombstones) {
      if (existing.has(entry.runtimeSessionId) || retired?.has(entry.runtimeSessionId)) continue;
      existing.set(entry.runtimeSessionId, createEntry(entry.runtimeSessionId, entry.suppressedSessionIds));
    }
    if (existing.size > 0) committedByWorkspaceId.set(workspaceId, existing);
  }
}

export function resetReplacedSessionTombstonesForTests(): void {
  stagedByWorkspaceId.clear();
  stagedClientAliasesByWorkspaceId.clear();
  committedByWorkspaceId.clear();
  retiredSuppressionByWorkspaceId.clear();
  retiredClientAliasesByWorkspaceId.clear();
  latestCommittedGeneration = 0;
  persistCommittedTombstones();
}

function createEntry(
  runtimeSessionId: string,
  suppressedSessionIds: readonly string[],
  committedGeneration = 0,
): TombstoneEntry {
  return {
    runtimeSessionId,
    suppressedSessionIds: new Set([runtimeSessionId, ...suppressedSessionIds]),
    committedGeneration,
  };
}

function addSuppressedIds(
  entry: TombstoneEntry,
  sessionIds: readonly string[],
): void {
  entry.suppressedSessionIds.add(entry.runtimeSessionId);
  for (const sessionId of sessionIds) {
    if (sessionId) {
      entry.suppressedSessionIds.add(sessionId);
    }
  }
}

function removeEntry(
  source: Map<string, WorkspaceTombstones>,
  workspaceId: string,
  runtimeSessionId: string,
): boolean {
  const workspace = source.get(workspaceId);
  const removed = workspace?.delete(runtimeSessionId) ?? false;
  if (workspace?.size === 0) {
    source.delete(workspaceId);
  }
  return removed;
}

function suppressedIdsForWorkspace(workspaceId: string): Set<string> {
  const suppressedIds = new Set<string>();
  for (const sessionId of stagedClientAliasesByWorkspaceId.get(workspaceId) ?? []) {
    suppressedIds.add(sessionId);
  }
  for (const sessionId of retiredClientAliasesByWorkspaceId.get(workspaceId) ?? []) {
    suppressedIds.add(sessionId);
  }
  for (const source of [
    stagedByWorkspaceId,
    committedByWorkspaceId,
    retiredSuppressionByWorkspaceId,
  ]) {
    for (const entry of source.get(workspaceId)?.values() ?? []) {
      for (const sessionId of entry.suppressedSessionIds) {
        suppressedIds.add(sessionId);
      }
    }
  }
  return suppressedIds;
}

function allWorkspaceIds(): Set<string> {
  return new Set([
    ...stagedByWorkspaceId.keys(),
    ...stagedClientAliasesByWorkspaceId.keys(),
    ...committedByWorkspaceId.keys(),
    ...retiredSuppressionByWorkspaceId.keys(),
    ...retiredClientAliasesByWorkspaceId.keys(),
  ]);
}

function removeClientAlias(
  source: Map<string, Set<string>>,
  workspaceId: string,
  sessionId: string,
): void {
  const aliases = source.get(workspaceId);
  aliases?.delete(sessionId);
  if (aliases?.size === 0) {
    source.delete(workspaceId);
  }
}

function persistCommittedTombstones(
  source: Map<string, WorkspaceTombstones> = committedByWorkspaceId,
): boolean {
  return writeSessionReplacementTombstones(Object.fromEntries(
    [...source.entries()].map(([workspaceId, entries]) => [
      workspaceId,
      [...entries.values()].map((entry) => ({
        runtimeSessionId: entry.runtimeSessionId,
        suppressedSessionIds: [...entry.suppressedSessionIds],
      })),
    ]),
  ));
}

function cloneTombstoneSource(
  source: Map<string, WorkspaceTombstones>,
): Map<string, WorkspaceTombstones> {
  return new Map([...source.entries()].map(([workspaceId, entries]) => [
    workspaceId,
    new Map([...entries.entries()].map(([runtimeSessionId, entry]) => [
      runtimeSessionId,
      createEntry(
        entry.runtimeSessionId,
        [...entry.suppressedSessionIds],
        entry.committedGeneration,
      ),
    ])),
  ]));
}

function replaceTombstoneSource(
  target: Map<string, WorkspaceTombstones>,
  source: Map<string, WorkspaceTombstones>,
): void {
  target.clear();
  for (const [workspaceId, entries] of source) {
    target.set(workspaceId, entries);
  }
}
