import {
  buildPendingWorkspaceUiKey,
  isPendingWorkspaceUiKey,
  type PendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  isPendingWorkspaceEntryAttended,
} from "#product/lib/domain/workspaces/creation/pending-attention";
import {
  pendingWorkspaceEntry,
  pendingWorkspaceEntryForUiKey,
} from "#product/lib/domain/workspaces/creation/pending-entry-registry";
import { cancelLatencyFlow } from "#product/lib/infra/measurement/measurement-port";
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

/**
 * Handles selecting a pending-workspace row, if that is what was clicked.
 *
 * Every live attempt has a sidebar row, so any of them can be clicked while its
 * launch is still running. A pending ui key resolves to no workspace at all, so
 * without this the selection fell through to "Workspace not found." — re-enter
 * the attempt's pending shell instead, landing on its creation receipt with
 * retry/back (PRO-230).
 *
 * Returns `true` when the selection was handled here and the caller must stop.
 */
export function selectPendingWorkspaceAttempt(args: {
  workspaceId: string;
  force?: boolean;
  latencyFlowId?: string | null;
  initialActiveSessionId?: string | null;
}): boolean {
  if (!isPendingWorkspaceUiKey(args.workspaceId)) {
    return false;
  }
  const selection = useSessionSelectionStore.getState();
  const entry = pendingWorkspaceEntryForUiKey(selection.pendingWorkspaces, args.workspaceId);
  if (!entry) {
    return false;
  }
  if (selection.selectedLogicalWorkspaceId === args.workspaceId && !args.force) {
    cancelLatencyFlow(args.latencyFlowId, "workspace_already_selected");
    return true;
  }
  enterPendingWorkspaceAttemptShell(entry.attemptId, {
    initialActiveSessionId: args.initialActiveSessionId,
  });
  cancelLatencyFlow(args.latencyFlowId, "pending_workspace_shell");
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
