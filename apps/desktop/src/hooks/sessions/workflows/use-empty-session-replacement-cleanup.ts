import { isSessionEmptyWithIntents } from "@/lib/domain/sessions/session-emptiness";
import { getSessionRecord, removeSessionRecord } from "@/stores/sessions/session-records";
import { useSessionIntentStore, getPromptOutboxEntriesForSession } from "@/stores/sessions/session-intent-store";
import { clearViewedSessionErrors } from "@/stores/preferences/workspace-ui-store";
import { useDismissSessionMutation } from "@anyharness/sdk-react";

export interface EmptySessionReplacementDeps {
  closeSessionSlotStream: (sessionId: string) => void;
  removeWorkspaceSessionRecord: (workspaceId: string, sessionId: string) => void;
  dismissSessionMutation: ReturnType<typeof useDismissSessionMutation>;
}

/**
 * Performs synchronous local cleanup of a replaced empty session and fires a
 * background runtime dismiss for materialized sessions. Returns whether cleanup
 * actually ran (false if the session had user work and was left alone).
 *
 * This is the pure-logic core used by both the hook wrapper and the session
 * creation workflow (which needs to run cleanup at an exact synchronous point).
 */
export function performEmptySessionReplacementCleanup(
  sessionId: string,
  workspaceId: string | null | undefined,
  deps: EmptySessionReplacementDeps,
): boolean {
  const record = getSessionRecord(sessionId);
  if (!record) {
    return false;
  }

  // Check emptiness including queued prompt intents
  const outboxEntries = getPromptOutboxEntriesForSession(sessionId);
  if (!isSessionEmptyWithIntents(record, outboxEntries.length)) {
    return false;
  }

  // Capture materialized id before local removal destroys the record
  const materializedSessionId = record.materializedSessionId;
  const resolvedWorkspaceId = record.workspaceId ?? workspaceId ?? null;

  // --- Local cleanup (order: stream close, intents, record, errors, cache) ---
  deps.closeSessionSlotStream(sessionId);
  useSessionIntentStore.getState().clearSession(sessionId);
  removeSessionRecord(sessionId);
  clearViewedSessionErrors([sessionId]);

  if (resolvedWorkspaceId) {
    deps.removeWorkspaceSessionRecord(resolvedWorkspaceId, sessionId);
  }

  // --- Runtime dismiss (fire-and-forget for materialized sessions) ---
  if (materializedSessionId && resolvedWorkspaceId) {
    void dismissMaterializedSession(
      materializedSessionId,
      resolvedWorkspaceId,
      deps.dismissSessionMutation,
    );
  }

  return true;
}


async function dismissMaterializedSession(
  materializedSessionId: string,
  workspaceId: string,
  dismissMutation: ReturnType<typeof useDismissSessionMutation>,
): Promise<void> {
  try {
    await dismissMutation.mutateAsync({
      workspaceId,
      sessionId: materializedSessionId,
    });
  } catch {
    // Best-effort cleanup. The session is already removed locally; if the
    // runtime dismiss fails the session will be garbage-collected by the
    // runtime's normal idle-session reaper.
  }
}
