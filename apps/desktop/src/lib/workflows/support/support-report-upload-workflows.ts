import type {
  GetSessionLiveConfigResponse,
  SessionRawNotificationEnvelope,
} from "@anyharness/sdk";
import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import type { SupportDiagnosticsBundle } from "@/lib/access/tauri/diagnostics";
import { sanitizeSupportUploadPayload } from "@/lib/domain/support/report-upload-sanitizer";
import { sanitizeSessionDebugExportedSession } from "@/lib/domain/support/session-debug/sanitizer";
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
const SENSITIVE_LIVE_CONFIG_KEY_PATTERN =
  /(prompt|instruction|message|content|text|rawInput|rawOutput|rawConfig)/i;

export interface SupportReportUploadDependencies<
  Connection extends AnyHarnessResolvedConnection = AnyHarnessResolvedConnection,
> {
  now: () => Date;
  collectDiagnostics: () => Promise<SupportDiagnosticsBundle | null>;
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
  runtimeDiagnostics: SupportDiagnosticsBundle | null;
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
    schemaVersion: 2,
    generatedAt: dependencies.now().toISOString(),
    correlation: serverCorrelation,
    report: {
      jobId: job.jobId,
      createdAt: job.createdAt,
      messagePresent: job.message.trim().length > 0,
      messageLength: job.message.trim().length,
      scope: job.scope,
      context: job.snapshot.context,
      openedAt: job.snapshot.openedAt,
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
      return notifications.slice(-MAX_RAW_NOTIFICATIONS_PER_SESSION).map(redactNotificationBody);
    },
  );

  const sanitized = sanitizeSessionDebugExportedSession({
    session: summary,
    normalizedEvents: Array.isArray(normalizedEvents) ? normalizedEvents : [],
    liveConfig: sanitizeLiveConfig(liveConfig),
    rawNotifications: Array.isArray(rawNotifications) ? rawNotifications : [],
    errors: [],
  });

  return {
    sessionId,
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

function redactNotificationBody(
  value: SessionRawNotificationEnvelope,
): SessionRawNotificationEnvelope {
  return {
    ...value,
    notification: { redacted: true },
  };
}

function sanitizeLiveConfig(
  value: GetSessionLiveConfigResponse | null,
): GetSessionLiveConfigResponse | null {
  return sanitizeLiveConfigValue(value) as GetSessionLiveConfigResponse | null;
}

function sanitizeLiveConfigValue(value: unknown, keyHint = ""): unknown {
  if (value == null) {
    return value;
  }
  if (typeof value === "string") {
    return SENSITIVE_LIVE_CONFIG_KEY_PATTERN.test(keyHint) ? "[REDACTED]" : value;
  }
  if (typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLiveConfigValue(item, keyHint));
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_LIVE_CONFIG_KEY_PATTERN.test(key)
      ? "[REDACTED]"
      : sanitizeLiveConfigValue(item, key);
  }
  return output;
}

function formatError(scope: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${scope}: ${message}`;
}
