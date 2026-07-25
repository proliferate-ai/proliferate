export interface TombstoneEntry {
  runtimeSessionId: string;
  suppressedSessionIds: Set<string>;
  committedGeneration: number;
}

export type WorkspaceTombstones = Map<string, TombstoneEntry>;

export function createTombstoneEntry(
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

export function addSuppressedSessionIds(
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

export function removeTombstoneEntry(
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

export function cloneTombstoneSource(
  source: Map<string, WorkspaceTombstones>,
): Map<string, WorkspaceTombstones> {
  return new Map([...source.entries()].map(([workspaceId, entries]) => [
    workspaceId,
    new Map([...entries.entries()].map(([runtimeSessionId, entry]) => [
      runtimeSessionId,
      createTombstoneEntry(
        entry.runtimeSessionId,
        [...entry.suppressedSessionIds],
        entry.committedGeneration,
      ),
    ])),
  ]));
}

export function replaceTombstoneSource(
  target: Map<string, WorkspaceTombstones>,
  source: Map<string, WorkspaceTombstones>,
): void {
  target.clear();
  for (const [workspaceId, entries] of source) {
    target.set(workspaceId, entries);
  }
}
