import {
  buildPendingWorkspaceUiKey,
  type PendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  type PendingWorkspaceRegistry,
} from "#product/lib/domain/workspaces/creation/pending-entry-registry";

export interface PendingWorkspaceAttentionSelection {
  selectedLogicalWorkspaceId: string | null;
  selectedWorkspaceId: string | null;
}

/**
 * Attention is a camera, not a lifecycle: it says whether the user is looking
 * at this attempt right now. The materialized-id clause covers the handoff
 * window after finalization swapped selection to the real workspace but the
 * pending entry has not been cleared yet.
 */
export function isPendingWorkspaceEntryAttended(
  entry: PendingWorkspaceEntry | null | undefined,
  selection: PendingWorkspaceAttentionSelection,
): boolean {
  if (!entry) {
    return false;
  }
  if (selection.selectedLogicalWorkspaceId === buildPendingWorkspaceUiKey(entry)) {
    return true;
  }
  return entry.workspaceId !== null && selection.selectedWorkspaceId === entry.workspaceId;
}

export function resolveAttendedPendingWorkspaceEntry(
  registry: PendingWorkspaceRegistry,
  selection: PendingWorkspaceAttentionSelection,
): PendingWorkspaceEntry | null {
  let materializedMatch: PendingWorkspaceEntry | null = null;
  for (const attemptId of registry.attemptOrder) {
    const entry = registry.entriesByAttemptId[attemptId];
    if (!entry) {
      continue;
    }
    if (selection.selectedLogicalWorkspaceId === buildPendingWorkspaceUiKey(entry)) {
      return entry;
    }
    if (
      materializedMatch === null
      && entry.workspaceId !== null
      && selection.selectedWorkspaceId === entry.workspaceId
    ) {
      materializedMatch = entry;
    }
  }
  return materializedMatch;
}
