import {
  isWorkspaceSetupSessionId,
  resolveWorkspaceSetupSessionId,
  WORKSPACE_SETUP_SESSION_TITLE,
} from "#product/lib/domain/workspaces/selection/setup-session";
import {
  createEmptySessionRecord,
  getSessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import {
  writeChatShellIntentForSession,
} from "#product/hooks/workspaces/workflows/tabs/workspace-shell-intent-writer";

export function ensureWorkspaceSetupSessionSurface(
  workspaceId: string,
  logicalWorkspaceId: string,
): string {
  const sessionId = resolveWorkspaceSetupSessionId(workspaceId);
  const existing = getSessionRecord(sessionId);
  if (!existing) {
    putSessionRecord({
      ...createEmptySessionRecord(sessionId, "", {
        materializedSessionId: null,
        sessionRelationship: { kind: "root" },
        title: WORKSPACE_SETUP_SESSION_TITLE,
        workspaceId,
      }),
      status: "idle",
      transcriptHydrated: true,
    });
  } else if (
    !isWorkspaceSetupSessionId(existing.sessionId)
    || existing.workspaceId !== workspaceId
  ) {
    throw new Error("Setup-session identity collision.");
  }

  useSessionSelectionStore.getState().setActiveSessionId(sessionId);
  writeChatShellIntentForSession({
    workspaceId,
    shellWorkspaceId: logicalWorkspaceId,
    sessionId,
    invalidateSessionIntent: false,
  });
  return sessionId;
}
