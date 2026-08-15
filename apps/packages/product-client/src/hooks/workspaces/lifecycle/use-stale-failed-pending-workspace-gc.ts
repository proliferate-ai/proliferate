import { useEffect } from "react";
import {
  pendingWorkspaceEntries,
} from "#product/lib/domain/workspaces/creation/pending-entry-registry";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

/** A failed row the user ignored for a day is not something they came back for. */
const STALE_FAILED_ATTEMPT_MS = 24 * 60 * 60 * 1000;

/**
 * How often the sweep runs. Far shorter than the age it collects, because the
 * point is that the sweep happens at all during a long session, not that it
 * happens promptly.
 */
const STALE_FAILED_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Drop failed attempts that outlived their usefulness.
 *
 * A failed attempt keeps its sidebar row on purpose: the error has to survive
 * until the user retries or dismisses it. Nothing expires it, though, so a long
 * session accumulates a row per ignored failure.
 *
 * The sweep runs on an interval rather than only at mount because both ends of
 * a mount-only sweep are wrong: the registry lives in memory, so it is empty at
 * every app start, and the host that owns this hook stays mounted for the whole
 * authenticated session, so the one sweep it would ever run is the empty one
 * (PRO-230 review finding 3).
 */
export function useStaleFailedPendingWorkspaceGc(): void {
  useEffect(() => {
    sweepStaleFailedPendingWorkspaces();
    const interval = setInterval(
      sweepStaleFailedPendingWorkspaces,
      STALE_FAILED_SWEEP_INTERVAL_MS,
    );
    return () => {
      clearInterval(interval);
    };
  }, []);
}

function sweepStaleFailedPendingWorkspaces(): void {
  const state = useSessionSelectionStore.getState();
  const cutoff = Date.now() - STALE_FAILED_ATTEMPT_MS;
  for (const entry of pendingWorkspaceEntries(state.pendingWorkspaces)) {
    if (entry.stage === "failed" && entry.createdAt < cutoff) {
      state.clearPendingWorkspaceEntry(entry.attemptId);
    }
  }
}
