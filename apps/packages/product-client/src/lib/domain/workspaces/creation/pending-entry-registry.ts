import {
  buildPendingWorkspaceUiKey,
  type PendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry";

/**
 * Client-owned pending workspace attempts, keyed by attempt id. A launch is
 * live while its attempt is still in this registry; selection never removes an
 * attempt, so switching workspaces cannot abort a launch.
 */
export interface PendingWorkspaceRegistry {
  entriesByAttemptId: Record<string, PendingWorkspaceEntry>;
  attemptOrder: string[];
}

export const EMPTY_PENDING_WORKSPACE_REGISTRY: PendingWorkspaceRegistry = {
  entriesByAttemptId: {},
  attemptOrder: [],
};

const EMPTY_PENDING_WORKSPACE_ENTRIES: readonly PendingWorkspaceEntry[] = [];

export function upsertPendingWorkspaceEntry(
  registry: PendingWorkspaceRegistry,
  entry: PendingWorkspaceEntry,
): PendingWorkspaceRegistry {
  const existing = registry.entriesByAttemptId[entry.attemptId] ?? null;
  if (existing === entry) {
    return registry;
  }
  return {
    entriesByAttemptId: {
      ...registry.entriesByAttemptId,
      [entry.attemptId]: entry,
    },
    attemptOrder: existing
      ? registry.attemptOrder
      : [...registry.attemptOrder, entry.attemptId],
  };
}

export function patchPendingWorkspaceEntry(
  registry: PendingWorkspaceRegistry,
  attemptId: string,
  patch: Partial<PendingWorkspaceEntry>,
): PendingWorkspaceRegistry {
  const existing = registry.entriesByAttemptId[attemptId] ?? null;
  if (!existing) {
    return registry;
  }
  return {
    entriesByAttemptId: {
      ...registry.entriesByAttemptId,
      [attemptId]: { ...existing, ...patch, attemptId },
    },
    attemptOrder: registry.attemptOrder,
  };
}

export function removePendingWorkspaceEntry(
  registry: PendingWorkspaceRegistry,
  attemptId: string,
): PendingWorkspaceRegistry {
  if (!registry.entriesByAttemptId[attemptId]) {
    return registry;
  }
  const { [attemptId]: _removed, ...entriesByAttemptId } = registry.entriesByAttemptId;
  return {
    entriesByAttemptId,
    attemptOrder: registry.attemptOrder.filter((id) => id !== attemptId),
  };
}

export function pendingWorkspaceEntry(
  registry: PendingWorkspaceRegistry,
  attemptId: string | null | undefined,
): PendingWorkspaceEntry | null {
  if (!attemptId) {
    return null;
  }
  return registry.entriesByAttemptId[attemptId] ?? null;
}

export function pendingWorkspaceEntries(
  registry: PendingWorkspaceRegistry,
): readonly PendingWorkspaceEntry[] {
  if (registry.attemptOrder.length === 0) {
    return EMPTY_PENDING_WORKSPACE_ENTRIES;
  }
  const entries: PendingWorkspaceEntry[] = [];
  for (const attemptId of registry.attemptOrder) {
    const entry = registry.entriesByAttemptId[attemptId];
    if (entry) {
      entries.push(entry);
    }
  }
  return entries;
}

export function pendingWorkspaceEntryForWorkspaceId(
  registry: PendingWorkspaceRegistry,
  workspaceId: string | null | undefined,
): PendingWorkspaceEntry | null {
  if (!workspaceId) {
    return null;
  }
  for (const attemptId of registry.attemptOrder) {
    const entry = registry.entriesByAttemptId[attemptId];
    if (entry?.workspaceId === workspaceId) {
      return entry;
    }
  }
  return null;
}

export function pendingWorkspaceEntryForUiKey(
  registry: PendingWorkspaceRegistry,
  workspaceUiKey: string | null | undefined,
): PendingWorkspaceEntry | null {
  if (!workspaceUiKey) {
    return null;
  }
  for (const attemptId of registry.attemptOrder) {
    const entry = registry.entriesByAttemptId[attemptId];
    if (entry && buildPendingWorkspaceUiKey(entry) === workspaceUiKey) {
      return entry;
    }
  }
  return null;
}
