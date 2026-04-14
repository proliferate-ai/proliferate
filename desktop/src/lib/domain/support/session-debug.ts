import type {
  GetSessionLiveConfigResponse,
  HealthResponse,
  Session,
  SessionEventEnvelope,
  SessionRawNotificationEnvelope,
} from "@anyharness/sdk";

export type SessionDebugRuntimeLocation = "local" | "cloud";
export type SessionDebugScopeKind = "session" | "workspace";

export interface SessionDebugRuntime {
  location: SessionDebugRuntimeLocation;
  url: string;
  status: string | null;
  version: string | null;
  home?: string;
  dbPath?: string;
  directSqliteAccess: boolean;
  note: string;
}

export interface SessionDebugWorkspace {
  uiWorkspaceId: string | null;
  logicalWorkspaceId: string | null;
  anyharnessWorkspaceId: string | null;
  owningSlotWorkspaceId: string | null;
}

export interface SessionDebugLocatorSession {
  id: string;
  owningWorkspaceId: string | null;
  agentKind: string | null;
  status: string | null;
  title: string | null;
  modelId: string | null;
  modeId: string | null;
  nativeSessionId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SessionDebugSqliteInfo {
  directAccess: boolean;
  dbPath?: string;
  unavailableReason?: string;
  tables: {
    sessions: "sessions";
    normalizedEvents: "session_events";
    rawNotifications: "session_raw_notifications";
    liveConfigSnapshots: "session_live_config_snapshots";
  };
  parameters: {
    workspace_id: string | null;
    session_id: string | null;
  };
}

export interface SessionDebugQueries {
  sessions: string;
  sessionEvents: string;
  rawNotifications: string;
  liveConfigSnapshots: string;
}

export interface SessionDebugApiPaths {
  baseUrl: string;
  health: string;
  workspaceSessions: string | null;
  session: string | null;
  normalizedEvents: string | null;
  rawNotifications: string | null;
  liveConfig: string | null;
}

export interface SessionDebugLocator {
  schemaVersion: 1;
  context: string;
  generatedAt: string;
  runtime: SessionDebugRuntime;
  workspace: SessionDebugWorkspace;
  session: SessionDebugLocatorSession | null;
  sqlite: SessionDebugSqliteInfo;
  queries: SessionDebugQueries;
  api: SessionDebugApiPaths;
}

export interface SessionDebugError {
  scope: string;
  message: string;
}

export interface SessionDebugExportedSession {
  session: Session | null;
  normalizedEvents: SessionEventEnvelope[] | null;
  rawNotifications: SessionRawNotificationEnvelope[] | null;
  liveConfig: GetSessionLiveConfigResponse | null;
  errors: SessionDebugError[];
}

export interface SessionDebugExport {
  schemaVersion: 1;
  generatedAt: string;
  scope: {
    kind: SessionDebugScopeKind;
    id: string;
  };
  locator: SessionDebugLocator;
  sessions: SessionDebugExportedSession[];
  errors: SessionDebugError[];
}

export interface BuildSessionDebugLocatorInput {
  generatedAt: Date | string;
  runtime: {
    location: SessionDebugRuntimeLocation;
    url: string;
    health: HealthResponse | null;
  };
  workspace: SessionDebugWorkspace;
  session?: SessionDebugLocatorSession | null;
}

export interface BuildSessionDebugExportInput {
  generatedAt: Date | string;
  scope: {
    kind: SessionDebugScopeKind;
    id: string;
  };
  locator: SessionDebugLocator;
  sessions: SessionDebugExportedSession[];
  errors?: SessionDebugError[];
}

const LOCATOR_CONTEXT =
  "Use this JSON to debug a Proliferate AnyHarness workspace or session. Prefer the API paths for cloud runtimes. For local runtimes, inspect runtime.dbPath with the SQLite queries below. Full event exports may include prompts, raw notifications, tool output, file paths, and runtime metadata.";

const SQLITE_TABLES: SessionDebugSqliteInfo["tables"] = {
  sessions: "sessions",
  normalizedEvents: "session_events",
  rawNotifications: "session_raw_notifications",
  liveConfigSnapshots: "session_live_config_snapshots",
};

export function buildSessionDebugLocator(
  input: BuildSessionDebugLocatorInput,
): SessionDebugLocator {
  const generatedAt = normalizeDate(input.generatedAt);
  const runtimeHome = input.runtime.location === "local"
    ? input.runtime.health?.runtimeHome?.trim() || undefined
    : undefined;
  const dbPath = runtimeHome ? appendSqliteFileName(runtimeHome) : undefined;
  const sessionId = input.session?.id ?? null;
  const workspaceId = input.workspace.anyharnessWorkspaceId
    ?? input.workspace.uiWorkspaceId
    ?? input.workspace.owningSlotWorkspaceId
    ?? null;
  const directSqliteAccess = input.runtime.location === "local" && !!dbPath;

  return {
    schemaVersion: 1,
    context: LOCATOR_CONTEXT,
    generatedAt,
    runtime: {
      location: input.runtime.location,
      url: input.runtime.url,
      status: input.runtime.health?.status ?? null,
      version: input.runtime.health?.version ?? null,
      ...(runtimeHome ? { home: runtimeHome } : {}),
      ...(dbPath ? { dbPath } : {}),
      directSqliteAccess,
      note: directSqliteAccess
        ? "Local runtime SQLite can be inspected directly at runtime.dbPath."
        : "Direct local SQLite access is unavailable for this runtime; use the API paths or exported JSON.",
    },
    workspace: input.workspace,
    session: input.session ?? null,
    sqlite: {
      directAccess: directSqliteAccess,
      ...(dbPath ? { dbPath } : {}),
      ...(!directSqliteAccess
        ? { unavailableReason: "Direct local SQLite access is unavailable for this runtime." }
        : {}),
      tables: SQLITE_TABLES,
      parameters: {
        workspace_id: workspaceId,
        session_id: sessionId,
      },
    },
    queries: buildSqliteQueries(sessionId !== null),
    api: buildApiPaths(input.runtime.url, workspaceId, sessionId),
  };
}

export function buildSessionDebugExport(
  input: BuildSessionDebugExportInput,
): SessionDebugExport {
  return {
    schemaVersion: 1,
    generatedAt: normalizeDate(input.generatedAt),
    scope: input.scope,
    locator: input.locator,
    sessions: input.sessions,
    errors: input.errors ?? [],
  };
}

export function suggestSessionDebugFileName(
  scope: SessionDebugScopeKind,
  id: string,
  date: Date,
): string {
  const idPrefix = sanitizeFileNamePart(id).slice(0, 8).replace(/[-_]+$/, "") || "unknown";
  return `proliferate-${scope}-debug-${idPrefix}-${formatUtcTimestamp(date)}.json`;
}

export function sessionLocatorFromSession(session: Session): SessionDebugLocatorSession {
  return {
    id: session.id,
    owningWorkspaceId: session.workspaceId,
    agentKind: session.agentKind,
    status: session.status,
    title: session.title ?? null,
    modelId: session.modelId ?? session.requestedModelId ?? null,
    modeId: session.modeId ?? session.requestedModeId ?? null,
    nativeSessionId: session.nativeSessionId ?? null,
    createdAt: session.createdAt ?? null,
    updatedAt: session.updatedAt ?? null,
  };
}

function buildSqliteQueries(hasSession: boolean): SessionDebugQueries {
  if (hasSession) {
    return {
      sessions: "SELECT * FROM sessions WHERE id = :session_id;",
      sessionEvents: "SELECT * FROM session_events WHERE session_id = :session_id ORDER BY seq ASC;",
      rawNotifications: "SELECT * FROM session_raw_notifications WHERE session_id = :session_id ORDER BY seq ASC;",
      liveConfigSnapshots: "SELECT * FROM session_live_config_snapshots WHERE session_id = :session_id;",
    };
  }

  return {
    sessions: "SELECT * FROM sessions WHERE workspace_id = :workspace_id ORDER BY updated_at DESC;",
    sessionEvents: "SELECT * FROM session_events WHERE session_id IN (SELECT id FROM sessions WHERE workspace_id = :workspace_id) ORDER BY session_id ASC, seq ASC;",
    rawNotifications: "SELECT * FROM session_raw_notifications WHERE session_id IN (SELECT id FROM sessions WHERE workspace_id = :workspace_id) ORDER BY session_id ASC, seq ASC;",
    liveConfigSnapshots: "SELECT * FROM session_live_config_snapshots WHERE session_id IN (SELECT id FROM sessions WHERE workspace_id = :workspace_id) ORDER BY session_id ASC;",
  };
}

function buildApiPaths(
  baseUrl: string,
  workspaceId: string | null,
  sessionId: string | null,
): SessionDebugApiPaths {
  const encodedWorkspaceId = workspaceId ? encodeURIComponent(workspaceId) : null;
  const encodedSessionId = sessionId ? encodeURIComponent(sessionId) : null;

  return {
    baseUrl,
    health: "/health",
    workspaceSessions: encodedWorkspaceId
      ? `/v1/sessions?workspace_id=${encodedWorkspaceId}&include_dismissed=true`
      : null,
    session: encodedSessionId ? `/v1/sessions/${encodedSessionId}` : null,
    normalizedEvents: encodedSessionId ? `/v1/sessions/${encodedSessionId}/events` : null,
    rawNotifications: encodedSessionId
      ? `/v1/sessions/${encodedSessionId}/raw-notifications`
      : null,
    liveConfig: encodedSessionId ? `/v1/sessions/${encodedSessionId}/live-config` : null,
  };
}

function appendSqliteFileName(runtimeHome: string): string {
  const separator = runtimeHome.includes("\\") && !runtimeHome.includes("/") ? "\\" : "/";
  return runtimeHome.endsWith("/") || runtimeHome.endsWith("\\")
    ? `${runtimeHome}db.sqlite`
    : `${runtimeHome}${separator}db.sqlite`;
}

function normalizeDate(date: Date | string): string {
  return typeof date === "string" ? date : date.toISOString();
}

function formatUtcTimestamp(date: Date): string {
  return [
    date.getUTCFullYear(),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate()),
    "-",
    pad2(date.getUTCHours()),
    pad2(date.getUTCMinutes()),
    pad2(date.getUTCSeconds()),
  ].join("");
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function sanitizeFileNamePart(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_-]/g, "");
}
