import {
  addSuppressedSessionIds,
  createTombstoneEntry,
  removeTombstoneEntry,
} from "@/hooks/sessions/workflows/session-replacement-tombstone-collections";
import {
  canPersistReplacedSessionTombstones,
} from "@/hooks/sessions/workflows/session-replacement-tombstone-durable-operations";
import {
  sessionReplacementTombstoneState,
} from "@/hooks/sessions/workflows/session-replacement-tombstone-state";

type SessionIdentity = { id: string };

export function stageReplacedClientSessionAlias(
  workspaceId: string,
  sessionId: string,
): boolean {
  const aliases = sessionReplacementTombstoneState.stagedClientAliasesByWorkspaceId
    .get(workspaceId) ?? new Set<string>();
  const sizeBefore = aliases.size;
  aliases.add(sessionId);
  sessionReplacementTombstoneState.stagedClientAliasesByWorkspaceId
    .set(workspaceId, aliases);
  return aliases.size !== sizeBefore;
}

export function retireStagedReplacedClientSessionAlias(
  workspaceId: string,
  sessionId: string,
): void {
  removeClientAlias(
    sessionReplacementTombstoneState.stagedClientAliasesByWorkspaceId,
    workspaceId,
    sessionId,
  );
  const aliases = sessionReplacementTombstoneState.retiredClientAliasesByWorkspaceId
    .get(workspaceId) ?? new Set<string>();
  aliases.add(sessionId);
  sessionReplacementTombstoneState.retiredClientAliasesByWorkspaceId
    .set(workspaceId, aliases);
}

export function clearStagedReplacedClientSessionAlias(
  workspaceId: string,
  sessionId: string,
): void {
  removeClientAlias(
    sessionReplacementTombstoneState.stagedClientAliasesByWorkspaceId,
    workspaceId,
    sessionId,
  );
}

export function stageReplacedSessionTombstone(
  workspaceId: string,
  runtimeSessionId: string,
  suppressedSessionIds: readonly string[] = [runtimeSessionId],
): boolean {
  if (sessionReplacementTombstoneState.committedByWorkspaceId
    .get(workspaceId)?.has(runtimeSessionId)) {
    return false;
  }
  const workspace = sessionReplacementTombstoneState.stagedByWorkspaceId
    .get(workspaceId) ?? new Map();
  const existing = workspace.get(runtimeSessionId);
  if (existing) {
    addSuppressedSessionIds(existing, suppressedSessionIds);
    return false;
  }
  workspace.set(
    runtimeSessionId,
    createTombstoneEntry(runtimeSessionId, suppressedSessionIds),
  );
  sessionReplacementTombstoneState.stagedByWorkspaceId.set(workspaceId, workspace);
  return true;
}

export function clearStagedReplacedSessionTombstone(
  workspaceId: string,
  runtimeSessionId: string,
): void {
  removeTombstoneEntry(
    sessionReplacementTombstoneState.stagedByWorkspaceId,
    workspaceId,
    runtimeSessionId,
  );
}

/** Runtime absence is confirmed, but stale in-flight lists still need a renderer fence. */
export function retireStagedReplacedSessionTombstone(
  workspaceId: string,
  runtimeSessionId: string,
): void {
  const stagedEntry = sessionReplacementTombstoneState.stagedByWorkspaceId
    .get(workspaceId)?.get(runtimeSessionId);
  if (stagedEntry) {
    const retired = sessionReplacementTombstoneState.retiredSuppressionByWorkspaceId
      .get(workspaceId) ?? new Map();
    retired.set(runtimeSessionId, stagedEntry);
    sessionReplacementTombstoneState.retiredSuppressionByWorkspaceId
      .set(workspaceId, retired);
  }
  removeTombstoneEntry(
    sessionReplacementTombstoneState.stagedByWorkspaceId,
    workspaceId,
    runtimeSessionId,
  );
}

export function isReplacedSessionTombstoned(
  workspaceId: string,
  sessionId: string,
): boolean {
  if (!canPersistReplacedSessionTombstones()) return true;
  return suppressedIdsForWorkspace(workspaceId).has(sessionId);
}

export function isReplacedSessionTombstonedInAnyWorkspace(
  sessionId: string,
): boolean {
  if (!canPersistReplacedSessionTombstones()) return true;
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
  if (!sessions) return undefined;
  if (!canPersistReplacedSessionTombstones()) return [];
  const suppressedIds = suppressedIdsForWorkspace(workspaceId);
  return suppressedIds.size === 0
    ? [...sessions]
    : sessions.filter((session) => !suppressedIds.has(session.id));
}

export function filterReplacedSessionIds(
  workspaceId: string,
  sessionIds: readonly string[],
): string[] {
  if (!canPersistReplacedSessionTombstones()) return [];
  const suppressedIds = suppressedIdsForWorkspace(workspaceId);
  return suppressedIds.size === 0
    ? [...sessionIds]
    : sessionIds.filter((sessionId) => !suppressedIds.has(sessionId));
}

export function hasStagedReplacedSessionTombstonesForWorkspace(
  workspaceId: string,
): boolean {
  return (sessionReplacementTombstoneState.stagedByWorkspaceId
    .get(workspaceId)?.size ?? 0) > 0
    || (sessionReplacementTombstoneState.stagedClientAliasesByWorkspaceId
      .get(workspaceId)?.size ?? 0) > 0;
}

export function shouldPreserveStagedReplacementShell(
  workspaceId: string,
  activeSessionWorkspaceId: string | null | undefined,
): boolean {
  return activeSessionWorkspaceId === workspaceId
    && hasStagedReplacedSessionTombstonesForWorkspace(workspaceId);
}

function suppressedIdsForWorkspace(workspaceId: string): Set<string> {
  const suppressedIds = new Set<string>();
  for (const sessionId of sessionReplacementTombstoneState
    .stagedClientAliasesByWorkspaceId.get(workspaceId) ?? []) {
    suppressedIds.add(sessionId);
  }
  for (const sessionId of sessionReplacementTombstoneState
    .retiredClientAliasesByWorkspaceId.get(workspaceId) ?? []) {
    suppressedIds.add(sessionId);
  }
  for (const source of [
    sessionReplacementTombstoneState.stagedByWorkspaceId,
    sessionReplacementTombstoneState.committedByWorkspaceId,
    sessionReplacementTombstoneState.retiredSuppressionByWorkspaceId,
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
    ...sessionReplacementTombstoneState.stagedByWorkspaceId.keys(),
    ...sessionReplacementTombstoneState.stagedClientAliasesByWorkspaceId.keys(),
    ...sessionReplacementTombstoneState.committedByWorkspaceId.keys(),
    ...sessionReplacementTombstoneState.retiredSuppressionByWorkspaceId.keys(),
    ...sessionReplacementTombstoneState.retiredClientAliasesByWorkspaceId.keys(),
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
