import { getSessionRecord } from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { buildPendingWorkspaceUiKey } from "@/lib/domain/workspaces/creation/pending-entry";

export interface ProjectedPendingWorkspaceSession {
  sessionId: string;
  workspaceId: string;
}

export function resolveProjectedPendingWorkspaceSession(): ProjectedPendingWorkspaceSession | null {
  const selection = useSessionSelectionStore.getState();
  const entry = selection.pendingWorkspaceEntry;
  const activeSessionId = selection.activeSessionId;
  if (!entry || !activeSessionId) {
    return null;
  }

  const pendingWorkspaceUiKey = buildPendingWorkspaceUiKey(entry);
  const record = getSessionRecord(activeSessionId);
  if (record?.workspaceId !== pendingWorkspaceUiKey) {
    return null;
  }

  return {
    sessionId: activeSessionId,
    workspaceId: pendingWorkspaceUiKey,
  };
}

export function waitForProjectedPendingWorkspaceSession(
  stopWhen: Promise<unknown>,
): Promise<ProjectedPendingWorkspaceSession | null> {
  const existing = resolveProjectedPendingWorkspaceSession();
  if (existing) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve) => {
    let resolved = false;
    let unsubscribe: () => void = () => {};
    const finish = (projected: ReturnType<typeof resolveProjectedPendingWorkspaceSession>) => {
      if (resolved) {
        return;
      }
      resolved = true;
      unsubscribe();
      resolve(projected);
    };
    unsubscribe = useSessionSelectionStore.subscribe(() => {
      const projected = resolveProjectedPendingWorkspaceSession();
      if (projected) {
        finish(projected);
      }
    });
    void stopWhen.then(
      () => finish(resolveProjectedPendingWorkspaceSession()),
      () => finish(resolveProjectedPendingWorkspaceSession()),
    );
  });
}
