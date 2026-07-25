import { useEffect } from "react";
import type { DesktopDiagnosticsBridge } from "@proliferate/product-client/host/desktop-diagnostics-bridge";
import {
  isSessionSlotBusy,
  pendingInteractionsForActivity,
  resolveSessionExecutionPhase,
  resolveSessionViewState,
} from "@proliferate/product-domain/sessions/activity";
import { activitySnapshotFromDirectoryEntry } from "@/lib/domain/sessions/directory/directory-activity";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";

type SessionEntries = ReturnType<typeof useSessionDirectoryStore.getState>["entriesById"];

function logTransitions(
  entries: SessionEntries,
  seen: Set<string>,
  diagnostics: DesktopDiagnosticsBridge,
): void {
  const liveIds = new Set<string>();
  for (const [sessionId, entry] of Object.entries(entries)) {
    liveIds.add(sessionId);
    const snapshot = activitySnapshotFromDirectoryEntry(entry);
    diagnostics.logSessionActivityTransition(sessionId, {
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
      diagnostics.forgetSessionActivity(sessionId);
    }
  }
  seen.clear();
  for (const sessionId of liveIds) {
    seen.add(sessionId);
  }
}

/** Dev tripwire for stuck busy indicators ("shows as generating long after
 * it finished"): logs every session view-state transition WITH the rule
 * inputs, so a wedged `working` names the input that held it. Desktop owns the
 * enablement flag and diagnostic sinks behind its bridge. */
export function useDebugSessionActivity(
  diagnostics: DesktopDiagnosticsBridge,
): void {
  useEffect(() => {
    if (!diagnostics.isSessionActivityDebugEnabled()) {
      return;
    }

    const seen = new Set<string>();
    logTransitions(
      useSessionDirectoryStore.getState().entriesById,
      seen,
      diagnostics,
    );
    const unsubscribe = useSessionDirectoryStore.subscribe((state) => {
      logTransitions(state.entriesById, seen, diagnostics);
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
        diagnostics.logSessionActivityHoldouts(holdouts);
      }
    }, 10_000);

    return () => {
      unsubscribe();
      clearInterval(holdoutTimer);
    };
  }, [diagnostics]);
}
