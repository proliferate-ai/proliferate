import {
  getAnyHarnessClient,
  resolveWorkspaceConnectionFromContext,
  useAnyHarnessWorkspaceContext,
  type AnyHarnessResolvedConnection,
} from "@anyharness/sdk-react";
import type {
  GetSessionLiveConfigResponse,
  HealthResponse,
  Session,
  SessionEventEnvelope,
  SessionRawNotificationEnvelope,
} from "@anyharness/sdk";
import { useState } from "react";
import {
  buildSessionDebugExport,
  buildSessionDebugLocator,
  sessionLocatorFromSession,
  suggestSessionDebugFileName,
  type SessionDebugError,
  type SessionDebugExportedSession,
  type SessionDebugLocator,
  type SessionDebugLocatorSession,
  type SessionDebugRuntimeLocation,
} from "@/lib/domain/support/session-debug";
import { copyText } from "@/platform/tauri/shell";
import { isTauriDesktop, saveDiagnosticJson } from "@/platform/tauri/diagnostics";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import type { SessionSlot } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";

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
}

export interface SessionDebugResolvedWorkspace {
  workspaceId: string;
  connection: AnyHarnessResolvedConnection;
}

export interface SessionDebugActionState {
  runtimeUrl: string;
  selectedWorkspaceId: string | null;
  selectedLogicalWorkspaceId: string | null;
  activeSessionId: string | null;
  sessionSlots: Record<string, Pick<
    SessionSlot,
    "agentKind" | "modeId" | "modelId" | "sessionId" | "status" | "title" | "workspaceId"
  >>;
}

export interface SessionDebugActionDependencies {
  now: () => Date;
  copyText: (value: string) => Promise<void>;
  saveDiagnosticJson: (
    suggestedFileName: string,
    contents: string,
  ) => Promise<string | null>;
  resolveWorkspace: (workspaceId: string) => Promise<SessionDebugResolvedWorkspace>;
  getClient: (connection: AnyHarnessResolvedConnection) => SessionDebugClient;
}

interface RuntimeDebugContext {
  resolved: SessionDebugResolvedWorkspace;
  client: SessionDebugClient;
  health: HealthResponse;
  runtimeLocation: SessionDebugRuntimeLocation;
}

interface ExportSessionInput {
  client: SessionDebugClient;
  sessionId: string;
}

interface BuildLocatorInput {
  state: SessionDebugActionState;
  runtimeContext: RuntimeDebugContext;
  generatedAt: Date;
  session: SessionDebugLocatorSession | null;
  owningSlotWorkspaceId: string | null;
}

export function useSessionDebugActions() {
  const workspaceContext = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const activeSessionId = useHarnessStore((state) => state.activeSessionId);
  const sessionSlots = useHarnessStore((state) => state.sessionSlots);
  const selectedLogicalWorkspaceId = useLogicalWorkspaceStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const showToast = useToastStore((state) => state.show);
  const [isCopyingInvestigationJson, setIsCopyingInvestigationJson] = useState(false);
  const [isExportingSessionDebugJson, setIsExportingSessionDebugJson] = useState(false);
  const [isExportingWorkspaceDebugJson, setIsExportingWorkspaceDebugJson] = useState(false);

  const actionState: SessionDebugActionState = {
    runtimeUrl,
    selectedWorkspaceId,
    selectedLogicalWorkspaceId,
    activeSessionId,
    sessionSlots,
  };
  const activeSessionWorkspaceId = resolveActiveSessionWorkspaceId(actionState);
  const canCopyInvestigationJson = Boolean(selectedWorkspaceId ?? activeSessionWorkspaceId);
  const canExportActiveSessionJson = isTauriDesktop()
    && Boolean(activeSessionId && activeSessionWorkspaceId);
  const canExportWorkspaceJson = isTauriDesktop() && Boolean(selectedWorkspaceId);

  const dependencies: SessionDebugActionDependencies = {
    now: () => new Date(),
    copyText,
    saveDiagnosticJson,
    resolveWorkspace: (workspaceId) => resolveWorkspaceConnectionFromContext(
      workspaceContext,
      workspaceId,
    ),
    getClient: (connection) => getAnyHarnessClient(connection),
  };

  async function handleCopyInvestigationJson() {
    setIsCopyingInvestigationJson(true);
    try {
      await copyInvestigationJsonAction(actionState, dependencies);
      showToast("Investigation JSON copied.", "info");
    } catch (error) {
      showToast(errorMessage(error));
    } finally {
      setIsCopyingInvestigationJson(false);
    }
  }

  async function handleExportActiveSessionJson() {
    setIsExportingSessionDebugJson(true);
    try {
      const outputPath = await exportActiveSessionDebugJsonAction(actionState, dependencies);
      if (outputPath) {
        showToast("Session debug JSON exported.", "info");
      }
    } catch (error) {
      showToast(errorMessage(error));
    } finally {
      setIsExportingSessionDebugJson(false);
    }
  }

  async function handleExportWorkspaceJson() {
    setIsExportingWorkspaceDebugJson(true);
    try {
      const outputPath = await exportWorkspaceDebugJsonAction(actionState, dependencies);
      if (outputPath) {
        showToast("Workspace debug JSON exported.", "info");
      }
    } catch (error) {
      showToast(errorMessage(error));
    } finally {
      setIsExportingWorkspaceDebugJson(false);
    }
  }

  return {
    canCopyInvestigationJson,
    canExportActiveSessionJson,
    canExportWorkspaceJson,
    handleCopyInvestigationJson,
    handleExportActiveSessionJson,
    handleExportWorkspaceJson,
    isCopyingInvestigationJson,
    isExportingSessionDebugJson,
    isExportingWorkspaceDebugJson,
  };
}

export async function copyInvestigationJsonAction(
  state: SessionDebugActionState,
  dependencies: SessionDebugActionDependencies,
): Promise<SessionDebugLocator> {
  const workspaceId = resolveWorkspaceIdForInvestigation(state);
  if (!workspaceId) {
    throw new Error("Select a workspace or active session before copying investigation JSON.");
  }

  const generatedAt = dependencies.now();
  const runtimeContext = await loadRuntimeDebugContext(state, dependencies, workspaceId);
  const activeSessionId = state.activeSessionId;
  const session = activeSessionId
    ? await loadLocatorSession(runtimeContext.client, activeSessionId).catch(() => (
      fallbackLocatorSession(state, activeSessionId)
    ))
    : null;
  const locator = buildLocator({
    state,
    runtimeContext,
    generatedAt,
    session,
    owningSlotWorkspaceId: activeSlot(state)?.workspaceId ?? null,
  });

  await dependencies.copyText(JSON.stringify(locator, null, 2));
  return locator;
}

export async function exportActiveSessionDebugJsonAction(
  state: SessionDebugActionState,
  dependencies: SessionDebugActionDependencies,
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
  const exportedSession = await exportSessionDebugData({
    client: runtimeContext.client,
    sessionId,
  });
  const locator = buildLocator({
    state,
    runtimeContext,
    generatedAt,
    session: exportedSession.session
      ? sessionLocatorFromSession(exportedSession.session)
      : fallbackLocatorSession(state, sessionId),
    owningSlotWorkspaceId: activeSlot(state)?.workspaceId ?? null,
  });
  const payload = buildSessionDebugExport({
    generatedAt,
    scope: { kind: "session", id: sessionId },
    locator,
    sessions: [exportedSession],
  });
  const contents = JSON.stringify(payload, null, 2);
  const fileName = suggestSessionDebugFileName("session", sessionId, generatedAt);

  return dependencies.saveDiagnosticJson(fileName, contents);
}

export async function exportWorkspaceDebugJsonAction(
  state: SessionDebugActionState,
  dependencies: SessionDebugActionDependencies,
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
  const locator = buildLocator({
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

async function loadRuntimeDebugContext(
  state: SessionDebugActionState,
  dependencies: SessionDebugActionDependencies,
  workspaceId: string,
): Promise<RuntimeDebugContext> {
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
      message: errorMessage(error),
    });
    return null;
  }
}

function buildLocator({
  state,
  runtimeContext,
  generatedAt,
  session,
  owningSlotWorkspaceId,
}: BuildLocatorInput): SessionDebugLocator {
  return buildSessionDebugLocator({
    generatedAt,
    runtime: {
      location: runtimeContext.runtimeLocation,
      url: runtimeContext.resolved.connection.runtimeUrl,
      health: runtimeContext.health,
    },
    workspace: {
      uiWorkspaceId: state.selectedWorkspaceId,
      logicalWorkspaceId: state.selectedLogicalWorkspaceId,
      anyharnessWorkspaceId: runtimeContext.resolved.connection.anyharnessWorkspaceId,
      owningSlotWorkspaceId,
    },
    session,
  });
}

function resolveWorkspaceIdForInvestigation(state: SessionDebugActionState): string | null {
  return resolveActiveSessionWorkspaceId(state) ?? state.selectedWorkspaceId;
}

function resolveActiveSessionWorkspaceId(state: SessionDebugActionState): string | null {
  const sessionId = state.activeSessionId;
  if (!sessionId) {
    return null;
  }

  return state.sessionSlots[sessionId]?.workspaceId ?? state.selectedWorkspaceId;
}

function activeSlot(state: SessionDebugActionState) {
  return state.activeSessionId ? state.sessionSlots[state.activeSessionId] ?? null : null;
}

function fallbackLocatorSession(
  state: SessionDebugActionState,
  sessionId: string,
): SessionDebugLocatorSession {
  const slot = state.sessionSlots[sessionId] ?? null;
  return {
    id: sessionId,
    owningWorkspaceId: slot?.workspaceId ?? null,
    agentKind: slot?.agentKind ?? null,
    status: slot?.status ?? null,
    title: slot?.title ?? null,
    modelId: slot?.modelId ?? null,
    modeId: slot?.modeId ?? null,
    nativeSessionId: null,
    createdAt: null,
    updatedAt: null,
  };
}

function resolveRuntimeLocation(
  localRuntimeUrl: string,
  resolvedRuntimeUrl: string,
): SessionDebugRuntimeLocation {
  return normalizeRuntimeUrl(localRuntimeUrl) === normalizeRuntimeUrl(resolvedRuntimeUrl)
    ? "local"
    : "cloud";
}

function normalizeRuntimeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Debug export failed.";
}
