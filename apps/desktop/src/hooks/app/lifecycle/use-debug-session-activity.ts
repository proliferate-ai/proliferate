import { useEffect } from "react";
import {
  isSessionSlotBusy,
  pendingInteractionsForActivity,
  resolveSessionExecutionPhase,
  resolveSessionViewState,
} from "@proliferate/product-domain/sessions/activity";
import { activitySnapshotFromDirectoryEntry } from "@/lib/domain/sessions/directory/directory-activity";
import {
  forgetSessionActivityDebugState,
  isSessionActivityDebugLoggingEnabled,
  logSessionActivityTransition,
} from "@/lib/infra/measurement/debug-session-activity";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";

type SessionEntries = ReturnType<typeof useSessionDirectoryStore.getState>["entriesById"];

function logTransitions(entries: SessionEntries, seen: Set<string>): void {
  const liveIds = new Set<string>();
  for (const [sessionId, entry] of Object.entries(entries)) {
    liveIds.add(sessionId);
    const snapshot = activitySnapshotFromDirectoryEntry(entry);
    logSessionActivityTransition(sessionId, {
      viewState: resolveSessionViewState(snapshot),
      executionPhase: resolveSessionExecutionPhase(snapshot),
      status: snapshot?.status ?? null,
      transcriptIsStreaming: snapshot?.transcript.isStreaming ?? false,
      streamConnectionState: snapshot?.streamConnectionState ?? null,
      pendingInteractionCount: snapshot
        ? pendingInteractionsForActivity(snapshot).length
        : 0,
      executionSummaryUpdatedAt: snapshot?.executionSummary?.updatedAt ?? null,
    });
  }
  for (const sessionId of seen) {
    if (!liveIds.has(sessionId)) {
      forgetSessionActivityDebugState(sessionId);
    }
  }
  seen.clear();
  for (const sessionId of liveIds) {
    seen.add(sessionId);
  }
}

/** Dev tripwire for stuck busy indicators ("shows as generating long after
 * it finished"): logs every session view-state transition WITH the rule
 * inputs, so a wedged `working` names the input that held it. Enabled by
 * VITE_PROLIFERATE_DEBUG_LATENCY or
 * `localStorage.setItem("proliferate.debugSessionActivity", "1")`. */
export function useDebugSessionActivity(): void {
  useEffect(() => {
    if (!isSessionActivityDebugLoggingEnabled()) {
      return;
    }

    const seen = new Set<string>();
    logTransitions(useSessionDirectoryStore.getState().entriesById, seen);
    const unsubscribe = useSessionDirectoryStore.subscribe((state) => {
      logTransitions(state.entriesById, seen);
    });

    // Transition logs go silent on a PERMANENTLY stuck entry (it changed
    // once, long ago). Name the holdouts on an interval so a wedged busy
    // indicator always has a current line to read.
    const holdoutTimer = setInterval(() => {
      const holdouts = Object.entries(useSessionDirectoryStore.getState().entriesById)
        .flatMap(([sessionId, entry]) => {
          const snapshot = activitySnapshotFromDirectoryEntry(entry);
          if (!snapshot || !isSessionSlotBusy(snapshot)) {
            return [];
          }
          return [{
            sessionId,
            materializedSessionId: entry.materializedSessionId,
            workspaceId: entry.workspaceId,
            viewState: resolveSessionViewState(snapshot),
            executionPhase: resolveSessionExecutionPhase(snapshot),
            executionSummary: snapshot.executionSummary ?? null,
            status: snapshot.status ?? null,
            transcriptIsStreaming: snapshot.transcript.isStreaming,
            streamConnectionState: snapshot.streamConnectionState ?? null,
            pendingInteractionCount: pendingInteractionsForActivity(snapshot).length,
          }];
        });
      if (holdouts.length > 0) {
        console.info("[session-activity] busy-holdouts", holdouts);
      }
    }, 10_000);

    return () => {
      unsubscribe();
      clearInterval(holdoutTimer);
    };
  }, []);
}
