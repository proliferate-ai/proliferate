import type {
  PersistedSessionReplacementTombstones,
} from "@/lib/workflows/sessions/session-replacement-tombstones-persistence";
import {
  createTombstoneEntry,
  type WorkspaceTombstones,
} from "@/hooks/sessions/workflows/session-replacement-tombstone-collections";

export function snapshotSessionReplacementTombstoneSource(
  source: Map<string, WorkspaceTombstones>,
): PersistedSessionReplacementTombstones {
  return Object.fromEntries(
    [...source.entries()].map(([workspaceId, entries]) => [
      workspaceId,
      [...entries.values()].map((entry) => ({
        runtimeSessionId: entry.runtimeSessionId,
        suppressedSessionIds: [...entry.suppressedSessionIds],
      })),
    ]),
  );
}

export function sessionReplacementTombstoneSourceFromSnapshot(
  persisted: PersistedSessionReplacementTombstones,
): Map<string, WorkspaceTombstones> {
  return new Map(Object.entries(persisted).map(([workspaceId, entries]) => [
    workspaceId,
    new Map(entries.map((entry) => [
      entry.runtimeSessionId,
      createTombstoneEntry(entry.runtimeSessionId, entry.suppressedSessionIds),
    ])),
  ]));
}
