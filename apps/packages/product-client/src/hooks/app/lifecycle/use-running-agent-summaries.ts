import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { isSessionSlotBusy } from "#product/domain/sessions/activity";
import { activitySnapshotFromDirectoryEntry } from "#product/lib/domain/sessions/directory/directory-activity";

export interface RunningAgentSummary {
  title: string | null;
  workspaceId: string | null;
}

/**
 * Reactive list of local sessions currently doing work, same "busy" definition
 * as `useRunningAgentCount`. The restart dialog uses this to name the sessions
 * a restart would interrupt (falling back to count-only copy when no entry has
 * a title).
 *
 * Selects the busy directory entries themselves (stable object references in
 * the store, so `useShallow` keeps the array referentially stable across
 * unrelated renders) and projects `{title, workspaceId}` in a `useMemo` keyed
 * off that stable array, rather than mapping fresh objects on every render.
 */
export function useRunningAgentSummaries(): RunningAgentSummary[] {
  const busyEntries = useSessionDirectoryStore(
    useShallow((state) =>
      Object.values(state.entriesById).filter((entry) =>
        isSessionSlotBusy(activitySnapshotFromDirectoryEntry(entry)),
      ),
    ),
  );
  return useMemo(
    () => busyEntries.map((entry) => ({ title: entry.title, workspaceId: entry.workspaceId })),
    [busyEntries],
  );
}
