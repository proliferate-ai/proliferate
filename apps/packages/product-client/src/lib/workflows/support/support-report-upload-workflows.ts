import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import type { SupportBundle } from "@proliferate/product-client/host/desktop-bridge";
import { sanitizeSessionDebugExportedSession } from "#product/lib/domain/support/session-debug/sanitizer";
import type {
  SupportReportJob,
  SupportReportServerCorrelation,
} from "#product/lib/domain/support/report-types";
import type {
  SessionDebugClient,
  SessionDebugResolvedWorkspace,
} from "#product/lib/workflows/support/session-debug-export-workflows";
import {
  boundedArrayValues,
  boundedTailArrayValues,
  isArraySafely,
  projectAttachments,
  projectContext,
  projectCorrelation,
  projectIsoTimestamp,
  projectRuntimeDiagnostics,
  projectScope,
  projectScopeKind,
  readOwnData,
  redactString,
  stringArrayValues,
  stringOrEmpty,
  type SupportReportPackageAttachment,
} from "#product/lib/workflows/support/support-report-upload-projection";

const MAX_WORKSPACES = 5;
const MAX_SESSIONS_PER_WORKSPACE = 3;
const MAX_EVENTS_PER_SESSION = 200;
const MAX_RAW_NOTIFICATIONS_PER_SESSION = 100;
const MAX_SESSION_CANDIDATES = 256;

export interface SupportReportUploadDependencies<
  Connection extends AnyHarnessResolvedConnection = AnyHarnessResolvedConnection,
> {
  now: () => Date;
  collectDiagnostics: () => Promise<SupportBundle | null>;
  resolveWorkspace: (workspaceId: string) => Promise<SessionDebugResolvedWorkspace<Connection>>;
  getClient: (connection: Connection) => SessionDebugClient;
}

interface SupportReportPackageWorkspace {
  requestedWorkspaceId: string;
  anyharnessWorkspaceId?: string;
  runtimeUrl?: string;
  sessions: SupportReportPackageSession[];
  errors: Array<{ scope: string; message: string }>;
}

interface SupportReportPackageSession {
  sessionId: string;
  summary: unknown;
  normalizedEvents: unknown[];
  liveConfig: unknown;
  rawNotifications: unknown[];
  errors: Array<{ scope: string; message: string }>;
}

export interface SupportReportPackage {
  schemaVersion: 2;
  generatedAt: string;
  correlation?: SupportReportServerCorrelation;
  report: {
    jobId: string;
    createdAt: string;
    messagePresent: boolean;
    messageLength: number;
    scope: SupportReportJob["scope"];
    context: SupportReportJob["snapshot"]["context"];
    openedAt: string;
  };
  runtimeDiagnostics: SupportBundle | null;
  workspaces: SupportReportPackageWorkspace[];
  attachments: SupportReportPackageAttachment[];
  collectionErrors: string[];
}

export async function buildSupportReportPackage<
  Connection extends AnyHarnessResolvedConnection,
>(
  job: SupportReportJob,
  dependencies: SupportReportUploadDependencies<Connection>,
  serverCorrelation?: SupportReportServerCorrelation,
): Promise<SupportReportPackage> {
  const collectionErrors: string[] = [];
  const collectedRuntimeDiagnostics = await dependencies.collectDiagnostics().catch(() => {
    collectionErrors.push(formatError("runtimeDiagnostics"));
    return null;
  });
  const runtimeDiagnostics = projectRuntimeDiagnostics(collectedRuntimeDiagnostics);
  const projectedScope = projectScope(readOwnData(job, "scope"));
  const workspaceIds = workspaceIdsForJob(job);
  const workspaces = projectedScope.kind === "app_only" ? [] : await Promise.all(
    workspaceIds.map((workspaceId) => collectWorkspaceDiagnostics(workspaceId, dependencies)),
  );
  const snapshot = readOwnData(job, "snapshot");
  const message = stringOrEmpty(readOwnData(job, "message"));
  const trimmedMessage = message.trim();

  return {
    schemaVersion: 2,
    generatedAt: dependencies.now().toISOString(),
    correlation: projectCorrelation(serverCorrelation),
    report: {
      jobId: redactString(readOwnData(job, "jobId")),
      createdAt: projectIsoTimestamp(readOwnData(job, "createdAt")),
      messagePresent: trimmedMessage.length > 0,
      messageLength: trimmedMessage.length,
      scope: projectedScope,
      context: projectContext(readOwnData(snapshot, "context")),
      openedAt: projectIsoTimestamp(readOwnData(snapshot, "openedAt")),
    },
    runtimeDiagnostics,
    workspaces,
    attachments: projectAttachments(readOwnData(job, "attachments")),
    collectionErrors,
  } satisfies SupportReportPackage;
}

async function collectWorkspaceDiagnostics<
  Connection extends AnyHarnessResolvedConnection,
>(
  workspaceId: string,
  dependencies: SupportReportUploadDependencies<Connection>,
): Promise<SupportReportPackageWorkspace> {
  const errors: Array<{ scope: string; message: string }> = [];
  try {
    const resolved = await dependencies.resolveWorkspace(workspaceId);
    const client = dependencies.getClient(resolved.connection);
    const anyharnessWorkspaceId = readOwnData(
      resolved.connection,
      "anyharnessWorkspaceId",
    );
    if (typeof anyharnessWorkspaceId !== "string") {
      throw new Error("workspace unavailable");
    }
    const sessions = await client.sessions.list(
      anyharnessWorkspaceId,
      { includeDismissed: true },
    );
    const sortedSessions = projectSessionCandidates(sessions);
    sortedSessions.sort(compareUpdatedAtDesc);
    if (sortedSessions.length > MAX_SESSIONS_PER_WORKSPACE) {
      sortedSessions.length = MAX_SESSIONS_PER_WORKSPACE;
    }
    const recentSessions = sortedSessions;
    const exportedSessions = await Promise.all(
      recentSessions.map((session) => collectSessionDiagnostics(client, session.id)),
    );

    return {
      requestedWorkspaceId: redactString(workspaceId),
      anyharnessWorkspaceId: redactString(anyharnessWorkspaceId),
      runtimeUrl: redactString(readOwnData(resolved.connection, "runtimeUrl")),
      sessions: exportedSessions,
      errors,
    };
  } catch {
    errors.push({ scope: "workspace", message: formatError("workspace") });
    return {
      requestedWorkspaceId: redactString(workspaceId),
      sessions: [],
      errors,
    };
  }
}

async function collectSessionDiagnostics(
  client: SessionDebugClient,
  sessionId: string,
): Promise<SupportReportPackageSession> {
  const errors: Array<{ scope: string; message: string }> = [];
  const summary = await captureSessionValue(errors, "session", () => client.sessions.get(sessionId));
  const normalizedEvents = await captureSessionValue(
    errors,
    "normalizedEvents",
    async () => {
      const events = await client.sessions.listEvents(sessionId);
      return boundedTailArrayValues<(typeof events)[number]>(events, MAX_EVENTS_PER_SESSION);
    },
  );
  const liveConfig = await captureSessionValue(
    errors,
    "liveConfig",
    () => client.sessions.getLiveConfig(sessionId),
  );
  const rawNotifications = await captureSessionValue(
    errors,
    "rawNotifications",
    async () => {
      const notifications = await client.sessions.listRawNotifications(sessionId);
      return boundedTailArrayValues<(typeof notifications)[number]>(
        notifications,
        MAX_RAW_NOTIFICATIONS_PER_SESSION,
      );
    },
  );

  const sanitized = sanitizeSessionDebugExportedSession({
    session: summary,
    normalizedEvents: isArraySafely(normalizedEvents) ? normalizedEvents : [],
    liveConfig,
    rawNotifications: isArraySafely(rawNotifications) ? rawNotifications : [],
    errors: [],
  });

  return {
    sessionId: redactString(sessionId),
    summary: sanitized.session,
    normalizedEvents: sanitized.normalizedEvents ?? [],
    liveConfig: sanitized.liveConfig,
    rawNotifications: sanitized.rawNotifications ?? [],
    errors,
  };
}

async function captureSessionValue<T>(
  errors: Array<{ scope: string; message: string }>,
  scope: string,
  load: () => Promise<T>,
): Promise<T | null> {
  try {
    return await load();
  } catch {
    errors.push({ scope, message: formatError(scope) });
    return null;
  }
}

function workspaceIdsForJob(job: unknown): string[] {
  const scope = readOwnData(job, "scope");
  if (projectScopeKind(readOwnData(scope, "kind")) === "app_only") {
    return [];
  }
  const workspaceIds = stringArrayValues(
    readOwnData(scope, "workspaceIds"),
    MAX_WORKSPACES,
  );
  if (workspaceIds.length > 0) {
    return workspaceIds;
  }
  const defaultWorkspaceId = readOwnData(readOwnData(job, "snapshot"), "defaultWorkspaceId");
  return typeof defaultWorkspaceId === "string" ? [defaultWorkspaceId] : [];
}

function compareUpdatedAtDesc(a: { updatedAt?: string | null }, b: { updatedAt?: string | null }) {
  return dateMs(b.updatedAt) - dateMs(a.updatedAt);
}

function projectSessionCandidates(
  value: unknown,
): Array<{ id: string; updatedAt?: string | null }> {
  const candidates: Array<{ id: string; updatedAt?: string | null }> = [];
  for (const session of boundedArrayValues(value, MAX_SESSION_CANDIDATES)) {
    const id = readOwnData(session, "id");
    if (typeof id !== "string") {
      continue;
    }
    const updatedAt = readOwnData(session, "updatedAt");
    candidates.push({
      id,
      updatedAt: typeof updatedAt === "string" || updatedAt == null ? updatedAt : null,
    });
  }
  return candidates;
}

function dateMs(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function formatError(scope: string): string {
  return `${scope}: unavailable`;
}
