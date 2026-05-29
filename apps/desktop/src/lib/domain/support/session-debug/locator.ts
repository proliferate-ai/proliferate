import type { HealthResponse } from "@anyharness/sdk";
import type { SessionDebugLocatorSession } from "@/lib/domain/support/session-debug/session-summary";

export type SessionDebugRuntimeLocation = "local" | "cloud";

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
