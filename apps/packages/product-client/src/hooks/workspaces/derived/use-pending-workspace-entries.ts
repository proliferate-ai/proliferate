import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { PendingWorkspaceEntry } from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  resolveAttendedPendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-attention";
import {
  pendingWorkspaceEntries,
  pendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry-registry";
import {
  isAwaitingCloudWorkspaceEntry,
} from "#product/lib/domain/workspaces/cloud/cloud-workspace-poll-plan";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

const EMPTY_PENDING_WORKSPACE_ENTRIES: readonly PendingWorkspaceEntry[] = [];

/** The pending attempt the user is looking at, if any. Never stored. */
export function useAttendedPendingWorkspaceEntry(): PendingWorkspaceEntry | null {
  const selection = useSessionSelectionStore(useShallow((state) => ({
    pendingWorkspaces: state.pendingWorkspaces,
    selectedLogicalWorkspaceId: state.selectedLogicalWorkspaceId,
    selectedWorkspaceId: state.selectedWorkspaceId,
  })));
  return useMemo(
    () => resolveAttendedPendingWorkspaceEntry(selection.pendingWorkspaces, {
      selectedLogicalWorkspaceId: selection.selectedLogicalWorkspaceId,
      selectedWorkspaceId: selection.selectedWorkspaceId,
    }),
    [
      selection.pendingWorkspaces,
      selection.selectedLogicalWorkspaceId,
      selection.selectedWorkspaceId,
    ],
  );
}

/**
 * Every attempt parked on cloud provisioning, attended or not: the polling
 * loop drives all of them so a launch completes while the user is elsewhere
 * (PRO-230).
 */
export function useAwaitingCloudWorkspaceEntries(): readonly PendingWorkspaceEntry[] {
  const registry = useSessionSelectionStore((state) => state.pendingWorkspaces);
  return useMemo(() => {
    const entries = pendingWorkspaceEntries(registry).filter(isAwaitingCloudWorkspaceEntry);
    return entries.length > 0 ? entries : EMPTY_PENDING_WORKSPACE_ENTRIES;
  }, [registry]);
}

export function usePendingWorkspaceEntries(): readonly PendingWorkspaceEntry[] {
  const registry = useSessionSelectionStore((state) => state.pendingWorkspaces);
  return useMemo(() => pendingWorkspaceEntries(registry), [registry]);
}

export function usePendingWorkspaceEntry(
  attemptId: string | null | undefined,
): PendingWorkspaceEntry | null {
  const registry = useSessionSelectionStore((state) => state.pendingWorkspaces);
  return useMemo(() => pendingWorkspaceEntry(registry, attemptId), [attemptId, registry]);
}
