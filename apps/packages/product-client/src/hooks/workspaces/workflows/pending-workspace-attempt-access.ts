import {
  buildPendingWorkspaceUiKey,
  type PendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  isPendingWorkspaceEntryAttended,
} from "#product/lib/domain/workspaces/creation/pending-attention";
import {
  pendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry-registry";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

export function getPendingWorkspaceEntry(
  attemptId: string | null | undefined,
): PendingWorkspaceEntry | null {
  return pendingWorkspaceEntry(
    useSessionSelectionStore.getState().pendingWorkspaces,
    attemptId,
  );
}

/**
 * The attempt has not been dismissed, so the launch pipeline may keep working:
 * patch the entry, materialize projected sessions, clear the entry. Independent
 * of what the user is currently looking at.
 */
export function isAttemptLive(attemptId: string): boolean {
  return getPendingWorkspaceEntry(attemptId) !== null;
}

/**
 * The user is looking at this attempt, so presentation side effects (selection,
 * arrival panel, activating the created session, composer focus) are allowed.
 */
export function isAttemptAttended(attemptId: string): boolean {
  const selection = useSessionSelectionStore.getState();
  return isPendingWorkspaceEntryAttended(
    pendingWorkspaceEntry(selection.pendingWorkspaces, attemptId),
    {
      selectedLogicalWorkspaceId: selection.selectedLogicalWorkspaceId,
      selectedWorkspaceId: selection.selectedWorkspaceId,
    },
  );
}

/**
 * Attend an attempt that is running unattended: its sidebar row and its failure
 * toast both point here, and both can fire long after selection moved on, so
 * the entry is re-read by id rather than captured (PRO-230).
 */
export function enterPendingWorkspaceAttemptShell(
  attemptId: string,
  options?: { initialActiveSessionId?: string | null },
): boolean {
  const entry = getPendingWorkspaceEntry(attemptId);
  if (!entry) {
    return false;
  }
  const workspaceUiKey = buildPendingWorkspaceUiKey(entry);
  const initialActiveSessionId = options?.initialActiveSessionId
    ?? useSessionDirectoryStore.getState().sessionIdsByWorkspaceId[workspaceUiKey]?.[0]
    ?? null;
  useSessionSelectionStore.getState().enterPendingWorkspaceShell(entry, {
    initialActiveSessionId,
  });
  return true;
}

/** Patching by attempt id cannot clobber another attempt's entry. */
export function patchAttempt(
  attemptId: string,
  patch: Partial<PendingWorkspaceEntry>,
): void {
  const entry = getPendingWorkspaceEntry(attemptId);
  if (!entry) {
    return;
  }
  useSessionSelectionStore.getState().setPendingWorkspaceEntry({
    ...entry,
    ...patch,
    attemptId,
  });
}
