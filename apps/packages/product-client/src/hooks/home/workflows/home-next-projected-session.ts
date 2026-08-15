import { getSessionRecord } from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { buildPendingWorkspaceUiKey } from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  pendingWorkspaceEntry,
  pendingWorkspaceEntryForUiKey,
} from "#product/lib/domain/workspaces/creation/pending-entry-registry";

export interface ProjectedPendingWorkspaceSession {
  sessionId: string;
  workspaceId: string;
}

/**
 * Resolves the projected session of one launch attempt. The attempt id is the
 * routing key: reading "the" selected pending session would misroute the first
 * prompt when the user switched to another workspace mid-launch.
 */
export function resolveProjectedPendingWorkspaceSession(
  attemptId?: string | null,
): ProjectedPendingWorkspaceSession | null {
  const selection = useSessionSelectionStore.getState();
  const activeSessionId = selection.activeSessionId;
  if (attemptId) {
    const entry = pendingWorkspaceEntry(selection.pendingWorkspaces, attemptId);
    if (!entry) {
      return null;
    }
    const pendingWorkspaceUiKey = buildPendingWorkspaceUiKey(entry);
    const sessionId = resolveProjectedSessionId(pendingWorkspaceUiKey, activeSessionId);
    return sessionId ? { sessionId, workspaceId: pendingWorkspaceUiKey } : null;
  }

  if (!activeSessionId) {
    return null;
  }
  const activeWorkspaceId = getSessionRecord(activeSessionId)?.workspaceId ?? null;
  const entry = pendingWorkspaceEntryForUiKey(selection.pendingWorkspaces, activeWorkspaceId);
  if (!entry || !activeWorkspaceId) {
    return null;
  }

  return {
    sessionId: activeSessionId,
    workspaceId: activeWorkspaceId,
  };
}

export function waitForProjectedPendingWorkspaceSession(
  stopWhen: Promise<unknown>,
  attemptId?: string | null,
): Promise<ProjectedPendingWorkspaceSession | null> {
  const existing = resolveProjectedPendingWorkspaceSession(attemptId);
  if (existing) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve) => {
    let resolved = false;
    let unsubscribe: () => void = () => {};
    const finish = (projected: ProjectedPendingWorkspaceSession | null) => {
      if (resolved) {
        return;
      }
      resolved = true;
      unsubscribe();
      resolve(projected);
    };
    unsubscribe = useSessionSelectionStore.subscribe(() => {
      const projected = resolveProjectedPendingWorkspaceSession(attemptId);
      if (projected) {
        finish(projected);
      }
    });
    void stopWhen.then(
      () => finish(resolveProjectedPendingWorkspaceSession(attemptId)),
      () => finish(resolveProjectedPendingWorkspaceSession(attemptId)),
    );
  });
}

function resolveProjectedSessionId(
  pendingWorkspaceUiKey: string,
  activeSessionId: string | null,
): string | null {
  if (
    activeSessionId
    && getSessionRecord(activeSessionId)?.workspaceId === pendingWorkspaceUiKey
  ) {
    return activeSessionId;
  }
  // The user may have switched away, so the projected session is no longer the
  // active one; the pending workspace's directory still owns it.
  const directorySessionIds = useSessionDirectoryStore.getState()
    .sessionIdsByWorkspaceId[pendingWorkspaceUiKey] ?? [];
  return directorySessionIds.find(
    (sessionId) => getSessionRecord(sessionId)?.workspaceId === pendingWorkspaceUiKey,
  ) ?? null;
}
