import {
  buildPendingWorkspaceUiKey,
  type PendingWorkspaceEntry,
  type PendingWorkspaceInitialSession,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import { createPendingSessionId } from "#product/lib/workflows/sessions/session-runtime";
import { logLatency } from "#product/lib/infra/measurement/measurement-port";
import {
  createEmptySessionRecord,
  getWorkspaceSessionRecords,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionIntentStore } from "#product/stores/sessions/session-intent-store";

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
      requestedModelId: initialSession.modelId,
      modeId: initialSession.modeId ?? null,
      title: initialSession.displayTitle ?? initialSession.modelId,
      optimisticPrompt: null,
      sessionRelationship: { kind: "root" },
    }),
    status: "starting",
    transcriptHydrated: true,
  });
  for (const [configId, value] of Object.entries(initialSession.launchControlValues ?? {})) {
    if (value.trim().length === 0) {
      continue;
    }
    useSessionIntentStore.getState().enqueueConfig({
      clientSessionId,
      workspaceId: pendingWorkspaceUiKey,
      configId,
      value,
      persistDefaultPreference: false,
    });
  }

  logLatency("workspace.entry.projected_session_shell.created", {
    attemptId: entry.attemptId,
    source: entry.source,
    pendingWorkspaceUiKey,
    clientSessionId,
    agentKind: initialSession.agentKind,
    modelId: initialSession.modelId,
    launchControlCount: Object.keys(initialSession.launchControlValues ?? {}).length,
  });

  return clientSessionId;
}
