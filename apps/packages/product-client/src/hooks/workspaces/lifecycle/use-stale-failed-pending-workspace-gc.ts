import { useEffect } from "react";
import {
  pendingWorkspaceEntries,
} from "#product/lib/domain/workspaces/creation/pending-entry-registry";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

/** A failed row the user ignored for a day is not something they came back for. */
const STALE_FAILED_ATTEMPT_MS = 24 * 60 * 60 * 1000;

/**
 * Drop failed attempts that outlived their usefulness.
 *
 * A failed attempt keeps its sidebar row on purpose: the error has to survive
 * until the user retries or dismisses it. Nothing expires it, though, so a
 * persisted registry accumulates a row per failure forever. This sweeps once
 * per app start, which is enough — a failure the user never came back to
 * within a day is not one they are coming back to (PRO-230).
 */
export function useStaleFailedPendingWorkspaceGc(): void {
  useEffect(() => {
    const state = useSessionSelectionStore.getState();
    const cutoff = Date.now() - STALE_FAILED_ATTEMPT_MS;
    for (const entry of pendingWorkspaceEntries(state.pendingWorkspaces)) {
      if (entry.stage === "failed" && entry.createdAt < cutoff) {
        state.clearPendingWorkspaceEntry(entry.attemptId);
      }
    }
  }, []);
}
