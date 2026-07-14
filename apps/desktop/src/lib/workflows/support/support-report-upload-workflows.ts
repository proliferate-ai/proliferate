import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import type { SupportBundle } from "@proliferate/product-client/host/desktop-bridge";
import { sanitizeSupportUploadPayload } from "@/lib/domain/support/report-upload-sanitizer";
import type {
  SupportReportJob,
  SupportReportServerCorrelation,
} from "@/lib/domain/support/report-types";
import type {
  SessionDebugClient,
  SessionDebugResolvedWorkspace,
} from "@/lib/workflows/support/session-debug-export-workflows";

const MAX_WORKSPACES = 5;
const MAX_SESSIONS_PER_WORKSPACE = 3;
const MAX_EVENTS_PER_SESSION = 200;
const MAX_RAW_NOTIFICATIONS_PER_SESSION = 100;

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
  schemaVersion: 3;
  generatedAt: string;
  correlation?: SupportReportServerCorrelation;
  report: {
    jobId: string;
    createdAt: string;
    message: string;
    scope: SupportReportJob["scope"];
    context: SupportReportJob["snapshot"]["context"];
    openedAt: string;
    activeWorkspaceId?: string;
    activeSessionId?: string;
    reportOpenedAt?: string;
  };
  runtimeDiagnostics: SupportBundle | null;
  workspaces: SupportReportPackageWorkspace[];
  attachments: Array<{
    clientFileId: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
  }>;
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
  const runtimeDiagnostics = await dependencies.collectDiagnostics().catch((error) => {
    collectionErrors.push(formatError("runtimeDiagnostics", error));
    return null;
  });
  const workspaceIds = workspaceIdsForJob(job).slice(0, MAX_WORKSPACES);
  const workspaces = job.scope.kind === "app_only" ? [] : await Promise.all(
    workspaceIds.map((workspaceId) => collectWorkspaceDiagnostics(workspaceId, dependencies)),
  );

  return sanitizeSupportUploadPayload({
    schemaVersion: 3,
    generatedAt: dependencies.now().toISOString(),
    correlation: serverCorrelation,
    report: {
      jobId: job.jobId,
      createdAt: job.createdAt,
      message: job.message.trim(),
      scope: job.scope,
      context: job.snapshot.context,
      openedAt: job.snapshot.openedAt,
      activeWorkspaceId: job.activeWorkspaceId,
      activeSessionId: job.activeSessionId,
      reportOpenedAt: job.reportOpenedAt,
    },
    runtimeDiagnostics,
    workspaces,
    attachments: job.attachments.map((attachment) => ({
      clientFileId: attachment.clientFileId,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      sizeBytes: attachment.sizeBytes,
    })),
    collectionErrors,
  } satisfies SupportReportPackage);
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
    const sessions = await client.sessions.list(
      resolved.connection.anyharnessWorkspaceId,
      { includeDismissed: true },
    );
    const recentSessions = [...sessions]
      .sort(compareUpdatedAtDesc)
      .slice(0, MAX_SESSIONS_PER_WORKSPACE);
    const exportedSessions = await Promise.all(
      recentSessions.map((session) => collectSessionDiagnostics(client, session.id)),
    );

    return {
      requestedWorkspaceId: workspaceId,
      anyharnessWorkspaceId: resolved.connection.anyharnessWorkspaceId,
      runtimeUrl: resolved.connection.runtimeUrl,
      sessions: exportedSessions,
      errors,
    };
  } catch (error) {
    errors.push({ scope: "workspace", message: formatError(workspaceId, error) });
    return {
      requestedWorkspaceId: workspaceId,
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
      return events.slice(-MAX_EVENTS_PER_SESSION);
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
      return notifications.slice(-MAX_RAW_NOTIFICATIONS_PER_SESSION);
    },
  );

  return {
    sessionId,
    summary,
    normalizedEvents: Array.isArray(normalizedEvents) ? normalizedEvents : [],
    liveConfig,
    rawNotifications: Array.isArray(rawNotifications) ? rawNotifications : [],
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
  } catch (error) {
    errors.push({ scope, message: formatError(scope, error) });
    return null;
  }
}

function workspaceIdsForJob(job: SupportReportJob): string[] {
  if (job.scope.kind === "app_only") {
    return [];
  }
  if (job.scope.workspaceIds.length > 0) {
    return job.scope.workspaceIds;
  }
  return job.snapshot.defaultWorkspaceId ? [job.snapshot.defaultWorkspaceId] : [];
}

function compareUpdatedAtDesc(a: { updatedAt?: string | null }, b: { updatedAt?: string | null }) {
  return dateMs(b.updatedAt) - dateMs(a.updatedAt);
}

function dateMs(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}


function formatError(scope: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${scope}: ${message}`;
}
