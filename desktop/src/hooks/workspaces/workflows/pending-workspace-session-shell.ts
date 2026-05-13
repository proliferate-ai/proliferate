import {
  buildPendingWorkspaceUiKey,
  type PendingWorkspaceEntry,
  type PendingWorkspaceInitialSession,
} from "@/lib/domain/workspaces/creation/pending-entry";
import { createPendingSessionId } from "@/lib/workflows/sessions/session-runtime";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import {
  createEmptySessionRecord,
  getWorkspaceSessionRecords,
  putSessionRecord,
} from "@/stores/sessions/session-records";

export function ensurePendingWorkspaceSessionShell(input: {
  entry: PendingWorkspaceEntry;
  initialSession: PendingWorkspaceInitialSession | null;
}): string | null {
  const { entry, initialSession } = input;
  if (!initialSession || initialSession.kind === "none") {
    return null;
  }

  const pendingWorkspaceUiKey = buildPendingWorkspaceUiKey(entry);
  const existingProjectedSession = Object.values(getWorkspaceSessionRecords(pendingWorkspaceUiKey))
    .find((session) => !session.materializedSessionId);
  if (existingProjectedSession) {
    return existingProjectedSession.sessionId;
  }

  const clientSessionId = createPendingSessionId(initialSession.agentKind);
  putSessionRecord({
    ...createEmptySessionRecord(clientSessionId, initialSession.agentKind, {
      workspaceId: pendingWorkspaceUiKey,
      materializedSessionId: null,
      modelId: initialSession.modelId,
      modeId: initialSession.modeId ?? null,
      title: initialSession.displayTitle ?? initialSession.modelId,
      optimisticPrompt: null,
      sessionRelationship: { kind: "root" },
    }),
    status: "starting",
    transcriptHydrated: true,
  });

  logLatency("workspace.entry.projected_session_shell.created", {
    attemptId: entry.attemptId,
    source: entry.source,
    pendingWorkspaceUiKey,
    clientSessionId,
    agentKind: initialSession.agentKind,
    modelId: initialSession.modelId,
  });

  return clientSessionId;
}
