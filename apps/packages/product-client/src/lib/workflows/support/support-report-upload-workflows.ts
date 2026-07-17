import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import type { SupportBundle } from "@proliferate/product-client/host/desktop-bridge";
import { sanitizeSupportUploadPayload } from "#product/lib/domain/support/report-upload-sanitizer";
import { sanitizeSessionDebugExportedSession } from "#product/lib/domain/support/session-debug/sanitizer";
import type {
  SupportReportJob,
  SupportReportServerCorrelation,
} from "#product/lib/domain/support/report-types";
import type {
  SessionDebugClient,
  SessionDebugResolvedWorkspace,
} from "#product/lib/workflows/support/session-debug-export-workflows";

const MAX_WORKSPACES = 5;
const MAX_SESSIONS_PER_WORKSPACE = 3;
const MAX_EVENTS_PER_SESSION = 200;
const MAX_RAW_NOTIFICATIONS_PER_SESSION = 100;
const MAX_SESSION_CANDIDATES = 256;
const MAX_ATTACHMENTS = 20;
const MAX_IDENTIFIER_LIST_ITEMS = 100;
const MAX_RUNTIME_LOGS = 4;
const MAX_RUNTIME_COLLECTION_ERRORS = 4;

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

  return sanitizeSupportUploadPayload({
    schemaVersion: 2,
    generatedAt: dependencies.now().toISOString(),
    correlation: projectCorrelation(serverCorrelation),
    report: {
      jobId: redactString(readOwnData(job, "jobId")),
      createdAt: projectString(readOwnData(job, "createdAt")),
      messagePresent: message.trim().length > 0,
      messageLength: message.trim().length,
      scope: projectedScope,
      context: projectContext(readOwnData(snapshot, "context")),
      openedAt: projectString(readOwnData(snapshot, "openedAt")),
    },
    runtimeDiagnostics,
    workspaces,
    attachments: projectAttachments(readOwnData(job, "attachments")),
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
    normalizedEvents: Array.isArray(normalizedEvents) ? normalizedEvents : [],
    liveConfig,
    rawNotifications: Array.isArray(rawNotifications) ? rawNotifications : [],
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

function projectCorrelation(
  correlation: unknown,
): SupportReportServerCorrelation | undefined {
  if (!isObject(correlation)) {
    return undefined;
  }
  return {
    reportId: redactString(readOwnData(correlation, "reportId")),
    requestId: redactNullableString(readOwnData(correlation, "requestId")),
    ownerUserId: redactString(readOwnData(correlation, "ownerUserId")),
    primaryOrganizationId: redactNullableString(
      readOwnData(correlation, "primaryOrganizationId"),
    ),
    primaryTenantId: redactString(readOwnData(correlation, "primaryTenantId")),
    tenantIds: redactStringList(readOwnData(correlation, "tenantIds")),
    cloudWorkspaceIds: redactStringList(readOwnData(correlation, "cloudWorkspaceIds")),
    cloudTargetIds: redactStringList(readOwnData(correlation, "cloudTargetIds")),
    anyharnessWorkspaceIds: redactStringList(
      readOwnData(correlation, "anyharnessWorkspaceIds"),
    ),
    sessionIds: redactStringList(readOwnData(correlation, "sessionIds")),
  };
}

function projectScope(scope: unknown): SupportReportJob["scope"] {
  return {
    kind: projectScopeKind(readOwnData(scope, "kind")),
    workspaceIds: redactStringList(readOwnData(scope, "workspaceIds")),
  };
}

function projectContext(
  context: unknown,
): SupportReportJob["snapshot"]["context"] {
  return {
    source: projectContextSource(readOwnData(context, "source")),
    intent: projectContextIntent(readOwnData(context, "intent")),
    pathname: redactNullableString(readOwnData(context, "pathname")),
    workspaceId: redactNullableString(readOwnData(context, "workspaceId")),
    workspaceName: redactNullableString(readOwnData(context, "workspaceName")),
    workspaceLocation: projectWorkspaceLocation(
      readOwnData(context, "workspaceLocation"),
    ),
  };
}

function projectRuntimeDiagnostics(bundle: unknown): SupportBundle | null {
  if (!isObject(bundle)) {
    return null;
  }
  const manifest = readOwnData(bundle, "manifest");
  const logs: SupportBundle["logs"] = [];
  for (const log of boundedArrayValues(readOwnData(bundle, "logs"), MAX_RUNTIME_LOGS)) {
    logs.push({
      source: normalizeDiagnosticSource(readOwnData(log, "source")),
      path: redactString(readOwnData(log, "path")),
      bytesRead: projectNonnegativeNumber(readOwnData(log, "bytesRead")),
      truncated: projectBoolean(readOwnData(log, "truncated")),
      text: projectString(readOwnData(log, "text")),
    });
  }
  const collectionErrors: string[] = [];
  for (const error of boundedArrayValues(
    readOwnData(bundle, "collectionErrors"),
    MAX_RUNTIME_COLLECTION_ERRORS,
  )) {
    collectionErrors.push(normalizeRuntimeCollectionError(error));
  }
  return {
    schemaVersion: projectNonnegativeNumber(readOwnData(bundle, "schemaVersion")),
    manifest: {
      appVersion: projectString(readOwnData(manifest, "appVersion")),
      runtimeVersion: projectNullableString(readOwnData(manifest, "runtimeVersion")),
      runtimeStatus: projectNullableString(readOwnData(manifest, "runtimeStatus")),
      runtimeHome: redactNullableString(readOwnData(manifest, "runtimeHome")),
      platform: projectString(readOwnData(manifest, "platform")),
      timestamp: projectString(readOwnData(manifest, "timestamp")),
    },
    health: projectRuntimeHealth(readOwnData(bundle, "health")),
    logs,
    collectionErrors,
  };
}

function projectRuntimeHealth(value: unknown): SupportBundle["health"] {
  if (value == null) {
    return value;
  }
  if (!isObject(value)) {
    return null;
  }
  return {
    runtimeHome: redactString(readOwnData(value, "runtimeHome")),
    status: projectString(readOwnData(value, "status")),
    version: projectString(readOwnData(value, "version")),
  };
}

function projectAttachments(value: unknown): SupportReportPackage["attachments"] {
  const attachments: SupportReportPackage["attachments"] = [];
  for (const attachment of boundedArrayValues(value, MAX_ATTACHMENTS)) {
    attachments.push({
      clientFileId: redactString(readOwnData(attachment, "clientFileId")),
      fileName: redactString(readOwnData(attachment, "fileName")),
      contentType: projectString(readOwnData(attachment, "contentType")),
      sizeBytes: projectNonnegativeNumber(readOwnData(attachment, "sizeBytes")),
    });
  }
  return attachments;
}

function normalizeDiagnosticSource(source: unknown): string {
  return source === "desktop" || source === "anyharness" ? source : "diagnostics";
}

function normalizeRuntimeCollectionError(error: unknown): string {
  if (error === "desktop: unavailable" || error === "anyharness: unavailable") {
    return error;
  }
  return "diagnostics: unavailable";
}

function redactStringList(values: unknown): string[] {
  const redacted: string[] = [];
  for (const value of boundedArrayValues(values, MAX_IDENTIFIER_LIST_ITEMS)) {
    redacted.push(redactString(value));
  }
  return redacted;
}

function redactNullableString(value: unknown): string | null | undefined {
  if (value == null) {
    return value;
  }
  return redactString(value);
}

function redactString(value: unknown): string {
  return typeof value === "string" ? `[redacted:${value.length}]` : "[redacted]";
}

function projectString(value: unknown): string {
  return typeof value === "string" ? value : "[redacted]";
}

function projectNullableString(value: unknown): string | null | undefined {
  return value == null ? value : projectString(value);
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function projectBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

function projectNonnegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function projectScopeKind(value: unknown): SupportReportJob["scope"]["kind"] {
  return value === "most_recent_workspace" || value === "choose_workspace"
    ? value
    : "app_only";
}

function projectContextSource(
  value: unknown,
): SupportReportJob["snapshot"]["context"]["source"] {
  return value === "home" || value === "settings" || value === "cloud_gated"
    ? value
    : "sidebar";
}

function projectContextIntent(
  value: unknown,
): SupportReportJob["snapshot"]["context"]["intent"] {
  return value === "unlimited_cloud" || value === "team_features" ? value : "general";
}

function projectWorkspaceLocation(
  value: unknown,
): SupportReportJob["snapshot"]["context"]["workspaceLocation"] {
  return value === "cloud" || value === "local" ? value : null;
}

function stringArrayValues(value: unknown, maxItems: number): string[] {
  return boundedArrayValues(value, maxItems).filter(
    (item): item is string => typeof item === "string",
  );
}

function boundedArrayValues<T = unknown>(value: unknown, maxItems: number): T[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const length = arrayLength(value);
  if (length == null) {
    return [];
  }
  const output: T[] = [];
  const itemCount = Math.min(length, maxItems);
  for (let index = 0; index < itemCount; index += 1) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      output.push(
        descriptor && "value" in descriptor ? descriptor.value as T : undefined as T,
      );
    } catch {
      output.push(undefined as T);
    }
  }
  return output;
}

function boundedTailArrayValues<T = unknown>(value: unknown, maxItems: number): T[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const length = arrayLength(value);
  if (length == null) {
    return [];
  }
  const output: T[] = [];
  const start = Math.max(0, length - maxItems);
  for (let index = start; index < length; index += 1) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      output.push(
        descriptor && "value" in descriptor ? descriptor.value as T : undefined as T,
      );
    } catch {
      output.push(undefined as T);
    }
  }
  return output;
}

function arrayLength(value: unknown[]): number | null {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "length");
    return descriptor
      && "value" in descriptor
      && typeof descriptor.value === "number"
      && Number.isSafeInteger(descriptor.value)
      && descriptor.value >= 0
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

function readOwnData(value: unknown, key: string): unknown {
  if (!isObject(value)) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && descriptor.enumerable === true && "value" in descriptor
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}
