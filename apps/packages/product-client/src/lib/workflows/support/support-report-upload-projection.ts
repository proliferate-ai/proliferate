import type { SupportBundle } from "@proliferate/product-client/host/desktop-bridge";
import type {
  SupportReportJob,
  SupportReportServerCorrelation,
} from "#product/lib/domain/support/report-types";
import { sanitizeSupportLogText } from "#product/lib/domain/support/report-upload-sanitizer";

const MAX_ATTACHMENTS = 20;
const MAX_IDENTIFIER_LIST_ITEMS = 100;
const MAX_RUNTIME_LOGS = 4;
const MAX_RUNTIME_COLLECTION_ERRORS = 4;
const ATTACHMENT_CONTENT_TYPES = new Set([
  "application/octet-stream",
  "application/pdf",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/webp",
  "text/plain",
]);
const PLATFORM_VALUES = new Set([
  "darwin-arm64",
  "darwin-x64",
  "linux-aarch64",
  "linux-x86_64",
  "macos-aarch64",
  "macos-x86_64",
  "windows-aarch64",
  "windows-x86_64",
]);
const RFC3339_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const VERSION_PATTERN = /^(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})$/;

export interface SupportReportPackageAttachment {
  clientFileId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

export function projectCorrelation(
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

export function projectScope(scope: unknown): SupportReportJob["scope"] {
  return {
    kind: projectScopeKind(readOwnData(scope, "kind")),
    workspaceIds: redactStringList(readOwnData(scope, "workspaceIds")),
  };
}

export function projectContext(
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

export function projectRuntimeDiagnostics(bundle: unknown): SupportBundle | null {
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
      text: sanitizeSupportLogText(readOwnData(log, "text")),
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
      appVersion: projectVersion(readOwnData(manifest, "appVersion")),
      runtimeVersion: projectNullableVersion(readOwnData(manifest, "runtimeVersion")),
      runtimeStatus: projectNullableRuntimeStatus(readOwnData(manifest, "runtimeStatus")),
      runtimeHome: redactNullableString(readOwnData(manifest, "runtimeHome")),
      platform: projectPlatform(readOwnData(manifest, "platform")),
      timestamp: projectIsoTimestamp(readOwnData(manifest, "timestamp")),
    },
    health: projectRuntimeHealth(readOwnData(bundle, "health")),
    logs,
    collectionErrors,
  };
}

export function projectAttachments(value: unknown): SupportReportPackageAttachment[] {
  const attachments: SupportReportPackageAttachment[] = [];
  for (const attachment of boundedArrayValues(value, MAX_ATTACHMENTS)) {
    attachments.push({
      clientFileId: redactString(readOwnData(attachment, "clientFileId")),
      fileName: redactString(readOwnData(attachment, "fileName")),
      contentType: projectAttachmentContentType(readOwnData(attachment, "contentType")),
      sizeBytes: projectNonnegativeNumber(readOwnData(attachment, "sizeBytes")),
    });
  }
  return attachments;
}

export function redactString(value: unknown): string {
  return typeof value === "string" ? `[redacted:${value.length}]` : "[redacted]";
}

export function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function projectIsoTimestamp(value: unknown): string {
  return typeof value === "string"
    && value.length <= 40
    && RFC3339_PATTERN.test(value)
    && Number.isFinite(Date.parse(value))
    ? value
    : "[redacted]";
}

export function projectScopeKind(value: unknown): SupportReportJob["scope"]["kind"] {
  return value === "most_recent_workspace" || value === "choose_workspace"
    ? value
    : "app_only";
}

export function stringArrayValues(value: unknown, maxItems: number): string[] {
  return boundedArrayValues(value, maxItems).filter(
    (item): item is string => typeof item === "string",
  );
}

export function boundedArrayValues<T = unknown>(value: unknown, maxItems: number): T[] {
  if (!isArraySafely(value)) {
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

export function boundedTailArrayValues<T = unknown>(
  value: unknown,
  maxItems: number,
): T[] {
  if (!isArraySafely(value)) {
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

export function readOwnData(value: unknown, key: string): unknown {
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

function projectRuntimeHealth(value: unknown): SupportBundle["health"] {
  if (value == null) {
    return value;
  }
  if (!isObject(value)) {
    return null;
  }
  return {
    runtimeHome: redactString(readOwnData(value, "runtimeHome")),
    status: projectHealthStatus(readOwnData(value, "status")),
    version: projectVersion(readOwnData(value, "version")),
  };
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

function projectBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

function projectNonnegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function projectVersion(value: unknown): string {
  return typeof value === "string" && VERSION_PATTERN.test(value) ? value : "[redacted]";
}

function projectNullableVersion(value: unknown): string | null | undefined {
  return value == null ? value : projectVersion(value);
}

function projectNullableRuntimeStatus(value: unknown): string | null | undefined {
  if (value == null) {
    return value;
  }
  return value === "starting"
    || value === "healthy"
    || value === "failed"
    || value === "stopped"
    ? value
    : "[redacted]";
}

function projectHealthStatus(value: unknown): string {
  return value === "ok" ? value : "[redacted]";
}

function projectPlatform(value: unknown): string {
  return typeof value === "string" && PLATFORM_VALUES.has(value) ? value : "[redacted]";
}

function projectAttachmentContentType(value: unknown): string {
  return typeof value === "string" && ATTACHMENT_CONTENT_TYPES.has(value)
    ? value
    : "application/octet-stream";
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

export function isArraySafely(value: unknown): value is unknown[] {
  try {
    return Array.isArray(value);
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}
