import type {
  GetSessionLiveConfigResponse,
  HealthResponse,
  ReplayRecordingSummary,
  Session,
  SessionEventEnvelope,
  SessionRawNotificationEnvelope,
} from "@anyharness/sdk";
import {
  buildSessionDebugLocatorFromActionState,
  fallbackLocatorSession,
  formatSessionDebugErrorMessage,
  requireMaterializedSessionIdForDebug,
  resolveActiveSessionRecord,
  resolveActiveSessionWorkspaceId,
  resolveMaterializedSessionIdForDebug,
  resolveRuntimeLocation,
  resolveWorkspaceIdForInvestigation,
  type SessionDebugActionState,
} from "@/lib/domain/support/session-debug/action-state";
import {
  buildSessionDebugExport,
  type SessionDebugError,
  type SessionDebugExportedSession,
} from "@/lib/domain/support/session-debug/export-models";
import { suggestSessionDebugFileName } from "@/lib/domain/support/session-debug/file-name";
import type { SessionDebugLocator } from "@/lib/domain/support/session-debug/locator";
import {
  sessionLocatorFromSession,
  type SessionDebugLocatorSession,
} from "@/lib/domain/support/session-debug/session-summary";

export interface SessionDebugRuntimeConnection {
  runtimeUrl: string;
  anyharnessWorkspaceId: string;
}

export interface SessionDebugClient {
  runtime: {
    getHealth: () => Promise<HealthResponse>;
  };
  sessions: {
    get: (sessionId: string) => Promise<Session>;
    list: (
      workspaceId?: string,
      options?: { includeDismissed?: boolean },
    ) => Promise<Session[]>;
    listEvents: (sessionId: string) => Promise<SessionEventEnvelope[]>;
    listRawNotifications: (sessionId: string) => Promise<SessionRawNotificationEnvelope[]>;
    getLiveConfig: (sessionId: string) => Promise<GetSessionLiveConfigResponse>;
  };
  replay?: {
    exportRecording: (input: {
      sessionId: string;
      name?: string;
    }) => Promise<{ recording: ReplayRecordingSummary }>;
  };
}

export interface SessionDebugResolvedWorkspace<
  Connection extends SessionDebugRuntimeConnection = SessionDebugRuntimeConnection,
> {
  workspaceId: string;
  connection: Connection;
}

export interface SessionDebugActionDependencies<
  Connection extends SessionDebugRuntimeConnection = SessionDebugRuntimeConnection,
> {
  now: () => Date;
  copyText: (value: string) => Promise<void>;
  saveDiagnosticJson: (
    suggestedFileName: string,
    contents: string,
  ) => Promise<string | null>;
  resolveWorkspace: (workspaceId: string) => Promise<SessionDebugResolvedWorkspace<Connection>>;
  getClient: (connection: Connection) => SessionDebugClient;
}

interface RuntimeDebugContext<Connection extends SessionDebugRuntimeConnection> {
  resolved: SessionDebugResolvedWorkspace<Connection>;
  client: SessionDebugClient;
  health: HealthResponse;
  runtimeLocation: "local" | "cloud";
}

interface ExportSessionInput {
  client: SessionDebugClient;
  sessionId: string;
}

export async function copyInvestigationJsonAction<
  Connection extends SessionDebugRuntimeConnection,
>(
  state: SessionDebugActionState,
  dependencies: SessionDebugActionDependencies<Connection>,
): Promise<SessionDebugLocator> {
  const workspaceId = resolveWorkspaceIdForInvestigation(state);
  if (!workspaceId) {
    throw new Error("Select a workspace or active session before copying investigation JSON.");
  }

  const generatedAt = dependencies.now();
  const runtimeContext = await loadRuntimeDebugContext(state, dependencies, workspaceId);
  const activeSessionId = state.activeSessionId;
  const materializedSessionId = activeSessionId
    ? resolveMaterializedSessionIdForDebug(state, activeSessionId)
    : null;
  const session = activeSessionId
    ? await loadLocatorSession(
      runtimeContext.client,
      materializedSessionId ?? activeSessionId,
    ).catch(() => (
      fallbackLocatorSession(state, activeSessionId)
    ))
    : null;
  const locator = buildLocatorForRuntimeContext({
    state,
    runtimeContext,
    generatedAt,
    session,
    owningSlotWorkspaceId: resolveActiveSessionRecord(state)?.workspaceId ?? null,
  });

  await dependencies.copyText(JSON.stringify(locator, null, 2));
  return locator;
}

export async function exportActiveSessionDebugJsonAction<
  Connection extends SessionDebugRuntimeConnection,
>(
  state: SessionDebugActionState,
  dependencies: SessionDebugActionDependencies<Connection>,
): Promise<string | null> {
  const sessionId = state.activeSessionId;
  if (!sessionId) {
    throw new Error("Select an active session before exporting session debug JSON.");
  }

  const workspaceId = resolveActiveSessionWorkspaceId(state);
  if (!workspaceId) {
    throw new Error("The active session does not have an owning workspace.");
  }

  const generatedAt = dependencies.now();
  const runtimeContext = await loadRuntimeDebugContext(state, dependencies, workspaceId);
  const materializedSessionId = requireMaterializedSessionIdForDebug(state, sessionId);
  const exportedSession = await exportSessionDebugData({
    client: runtimeContext.client,
    sessionId: materializedSessionId,
  });
  const locator = buildLocatorForRuntimeContext({
    state,
    runtimeContext,
    generatedAt,
    session: exportedSession.session
      ? sessionLocatorFromSession(exportedSession.session)
      : fallbackLocatorSession(state, sessionId),
    owningSlotWorkspaceId: resolveActiveSessionRecord(state)?.workspaceId ?? null,
  });
  const payload = buildSessionDebugExport({
    generatedAt,
    scope: { kind: "session", id: materializedSessionId },
    locator,
    sessions: [exportedSession],
  });
  const contents = JSON.stringify(payload, null, 2);
  const fileName = suggestSessionDebugFileName("session", materializedSessionId, generatedAt);

  return dependencies.saveDiagnosticJson(fileName, contents);
}

export async function exportWorkspaceDebugJsonAction<
  Connection extends SessionDebugRuntimeConnection,
>(
  state: SessionDebugActionState,
  dependencies: SessionDebugActionDependencies<Connection>,
): Promise<string | null> {
  const workspaceId = state.selectedWorkspaceId;
  if (!workspaceId) {
    throw new Error("Select a workspace before exporting workspace debug JSON.");
  }

  const generatedAt = dependencies.now();
  const runtimeContext = await loadRuntimeDebugContext(state, dependencies, workspaceId);
  const anyharnessWorkspaceId = runtimeContext.resolved.connection.anyharnessWorkspaceId;
  const sessions = await runtimeContext.client.sessions.list(
    anyharnessWorkspaceId,
    { includeDismissed: true },
  );
  const exportedSessions = await Promise.all(
    sessions.map((session) => exportSessionDebugData({
      client: runtimeContext.client,
      sessionId: session.id,
    })),
  );
  const locator = buildLocatorForRuntimeContext({
    state,
    runtimeContext,
    generatedAt,
    session: null,
    owningSlotWorkspaceId: null,
  });
  const payload = buildSessionDebugExport({
    generatedAt,
    scope: { kind: "workspace", id: anyharnessWorkspaceId },
    locator,
    sessions: exportedSessions,
  });
  const contents = JSON.stringify(payload, null, 2);
  const fileName = suggestSessionDebugFileName("workspace", anyharnessWorkspaceId, generatedAt);

  return dependencies.saveDiagnosticJson(fileName, contents);
}

export async function exportReplayRecordingAction<
  Connection extends SessionDebugRuntimeConnection,
>(
  state: SessionDebugActionState,
  dependencies: SessionDebugActionDependencies<Connection>,
): Promise<ReplayRecordingSummary> {
  const sessionId = state.activeSessionId;
  if (!sessionId) {
    throw new Error("Select an active session before exporting a replay recording.");
  }

  const workspaceId = resolveActiveSessionWorkspaceId(state);
  if (!workspaceId) {
    throw new Error("The active session does not have an owning workspace.");
  }

  const runtimeContext = await loadRuntimeDebugContext(state, dependencies, workspaceId);
  if (runtimeContext.health.capabilities?.replay !== true) {
    throw new Error("Replay recording export is disabled for this runtime.");
  }
  if (!runtimeContext.client.replay) {
    throw new Error("The AnyHarness SDK does not support replay export.");
  }
  const materializedSessionId = requireMaterializedSessionIdForDebug(state, sessionId);

  const response = await runtimeContext.client.replay.exportRecording({
    sessionId: materializedSessionId,
  });
  return response.recording;
}

async function loadRuntimeDebugContext<Connection extends SessionDebugRuntimeConnection>(
  state: SessionDebugActionState,
  dependencies: SessionDebugActionDependencies<Connection>,
  workspaceId: string,
): Promise<RuntimeDebugContext<Connection>> {
  const resolved = await dependencies.resolveWorkspace(workspaceId);
  const client = dependencies.getClient(resolved.connection);
  const health = await client.runtime.getHealth();

  return {
    resolved,
    client,
    health,
    runtimeLocation: resolveRuntimeLocation(state.runtimeUrl, resolved.connection.runtimeUrl),
  };
}

async function loadLocatorSession(
  client: SessionDebugClient,
  sessionId: string,
): Promise<SessionDebugLocatorSession> {
  return sessionLocatorFromSession(await client.sessions.get(sessionId));
}

async function exportSessionDebugData({
  client,
  sessionId,
}: ExportSessionInput): Promise<SessionDebugExportedSession> {
  const errors: SessionDebugError[] = [];
  const session = await captureSessionFetch(
    errors,
    "session",
    () => client.sessions.get(sessionId),
  );
  const normalizedEvents = await captureSessionFetch(
    errors,
    "normalizedEvents",
    () => client.sessions.listEvents(sessionId),
  );
  const rawNotifications = await captureSessionFetch(
    errors,
    "rawNotifications",
    () => client.sessions.listRawNotifications(sessionId),
  );
  const liveConfig = await captureSessionFetch(
    errors,
    "liveConfig",
    () => client.sessions.getLiveConfig(sessionId),
  );

  return {
    session,
    normalizedEvents,
    rawNotifications,
    liveConfig,
    errors,
  };
}

async function captureSessionFetch<T>(
  errors: SessionDebugError[],
  scope: string,
  fetchValue: () => Promise<T>,
): Promise<T | null> {
  try {
    return await fetchValue();
  } catch (error) {
    errors.push({
      scope,
      message: formatSessionDebugErrorMessage(error),
    });
    return null;
  }
}

function buildLocatorForRuntimeContext<Connection extends SessionDebugRuntimeConnection>({
  state,
  runtimeContext,
  generatedAt,
  session,
  owningSlotWorkspaceId,
}: {
  state: SessionDebugActionState;
  runtimeContext: RuntimeDebugContext<Connection>;
  generatedAt: Date;
  session: SessionDebugLocatorSession | null;
  owningSlotWorkspaceId: string | null;
}): SessionDebugLocator {
  return buildSessionDebugLocatorFromActionState({
    state,
    generatedAt,
    runtime: {
      location: runtimeContext.runtimeLocation,
      url: runtimeContext.resolved.connection.runtimeUrl,
      health: runtimeContext.health,
      anyharnessWorkspaceId: runtimeContext.resolved.connection.anyharnessWorkspaceId,
    },
    session,
    owningSlotWorkspaceId,
  });
}
