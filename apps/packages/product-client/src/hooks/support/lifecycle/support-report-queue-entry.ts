import type {
  PersistedSupportArtifactRefV1,
  PreparedSupportSnapshotV1,
  SupportSnapshotConsentV1,
} from "@proliferate/product-client/host/desktop-bridge";
import type {
  SupportReportAttachmentPayload,
  SupportReportJob,
  SupportReportSnapshotIntent,
} from "#product/lib/domain/support/report-types";

import { canonicalQueueJson } from "./support-report-queue-canonical";

const MAX_ID_BYTES = 128;
const MAX_PATH_BYTES = 4_096;
const MAX_MESSAGE_CHARACTERS = 5_000;
const MAX_CREDIT_NAME_CHARACTERS = 200;
const MAX_ATTACHMENTS = 20;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const MAX_ATTACHMENT_BASE64_BYTES = 4 * Math.ceil(MAX_ATTACHMENT_BYTES / 3);
const MAX_DIAGNOSTICS_BYTES = 25 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;
const ARTIFACT_ID = /^ssv1_[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface PersistedSupportReportJob {
  job: SupportReportJob;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  lastFailureKind: string | null;
  lastFailureToastAt: string | null;
  lastFailureToastKind: string | null;
}

export function normalizeSupportReportJobForEnqueue(
  value: unknown,
  forceNoSnapshot = false,
): SupportReportJob {
  let decoded: unknown;
  try {
    decoded = JSON.parse(canonicalQueueJson(value)) as unknown;
  } catch {
    throw new Error("Support report job is not canonical JSON.");
  }
  const job = record(decoded, "job");
  delete job.includeLogs;
  if (forceNoSnapshot || !Object.prototype.hasOwnProperty.call(job, "supportSnapshot")) {
    job.supportSnapshot = { kind: "none" };
  }
  return parseSupportReportJob(job);
}

export function createPersistedSupportReportJob(
  job: SupportReportJob,
): PersistedSupportReportJob {
  return {
    job,
    attemptCount: 0,
    nextAttemptAt: null,
    lastError: null,
    lastFailureKind: null,
    lastFailureToastAt: null,
    lastFailureToastKind: null,
  };
}

export function parsePersistedSupportReportJob(value: unknown): PersistedSupportReportJob {
  const entry = exactRecord(value, [
    "attemptCount",
    "job",
    "lastError",
    "lastFailureKind",
    "lastFailureToastAt",
    "lastFailureToastKind",
    "nextAttemptAt",
  ]);
  safeInteger(entry.attemptCount, "attemptCount", Number.MAX_SAFE_INTEGER - 1);
  nullableTimestamp(entry.nextAttemptAt, "nextAttemptAt");
  nullableBoundedString(entry.lastError, 4_096, "lastError");
  nullableFailureKind(entry.lastFailureKind, "lastFailureKind");
  nullableTimestamp(entry.lastFailureToastAt, "lastFailureToastAt");
  nullableFailureKind(entry.lastFailureToastKind, "lastFailureToastKind");
  parseSupportReportJob(entry.job);
  return entry as unknown as PersistedSupportReportJob;
}

export function parsePackagedPersistedSupportReportJob(
  value: unknown,
): PersistedSupportReportJob {
  const entry = parsePersistedSupportReportJob(value);
  assertPackagedSupportReportJob(entry.job);
  return entry;
}

export function assertPackagedSupportReportJob(job: SupportReportJob): void {
  for (const attachment of job.attachments) {
    if (!attachment.stagedPath || attachment.dataBase64 !== undefined) {
      invalid("packaged attachment reference");
    }
  }
}

export function canonicalSupportReportJobBytes(job: SupportReportJob): string {
  return canonicalQueueJson(job);
}

export function supportArtifactTuple(job: SupportReportJob): string | null {
  if (job.supportSnapshot.kind === "none") return null;
  const artifact = job.supportSnapshot.artifact;
  return canonicalQueueJson({
    artifactId: artifact.artifactId,
    sha256: artifact.sha256,
    sizeBytes: artifact.sizeBytes,
    snapshotId: artifact.snapshotId,
  });
}

export function persistedArtifactReference(
  job: SupportReportJob,
): PersistedSupportArtifactRefV1 | null {
  if (job.supportSnapshot.kind === "none") return null;
  const artifact = job.supportSnapshot.artifact;
  return {
    clientJobId: job.jobId,
    artifactId: artifact.artifactId,
    snapshotId: artifact.snapshotId,
    sizeBytes: artifact.sizeBytes,
    sha256: artifact.sha256,
  };
}

export function stagedAttachmentPaths(job: SupportReportJob): string[] {
  return job.attachments.flatMap((attachment) =>
    attachment.stagedPath ? [attachment.stagedPath] : []
  );
}

function parseSupportReportJob(value: unknown): SupportReportJob {
  const job = allowedRecord(value, [
    "attachments",
    "createdAt",
    "creditConsent",
    "jobId",
    "kind",
    "message",
    "publicContentConsent",
    "scope",
    "snapshot",
    "supportSnapshot",
  ], [
    "activeSessionId",
    "activeWorkspaceId",
    "creditName",
    "includeLogs",
    "notifyMe",
    "reportOpenedAt",
    "urgent",
  ]);
  boundedString(job.jobId, 1, MAX_ID_BYTES, "jobId");
  timestamp(job.createdAt, "createdAt");
  boundedCharacters(job.message, 0, MAX_MESSAGE_CHARACTERS, "message");
  boolean(job.publicContentConsent, "publicContentConsent");
  oneOf(job.kind, ["bug", "feature"], "kind");
  boolean(job.creditConsent, "creditConsent");
  optionalNullableCharacters(
    job.creditName,
    MAX_CREDIT_NAME_CHARACTERS,
    "creditName",
  );
  optionalBoolean(job.urgent, "urgent");
  optionalBoolean(job.notifyMe, "notifyMe");
  optionalBoolean(job.includeLogs, "includeLogs");
  optionalBoundedString(job.activeWorkspaceId, MAX_ID_BYTES, "activeWorkspaceId");
  optionalBoundedString(job.activeSessionId, MAX_ID_BYTES, "activeSessionId");
  optionalTimestamp(job.reportOpenedAt, "reportOpenedAt");
  parseScope(job.scope);
  parseWindowSnapshot(job.snapshot);
  const attachments = parseAttachments(job.attachments);
  if ((job.message as string).trim().length === 0 && attachments.length === 0) {
    invalid("empty report");
  }
  parseSnapshotIntent(job.supportSnapshot, job.jobId as string);
  return job as unknown as SupportReportJob;
}

function parseScope(value: unknown): void {
  const scope = exactRecord(value, ["kind", "workspaceIds"]);
  oneOf(scope.kind, ["app_only", "choose_workspace", "most_recent_workspace"], "scope.kind");
  stringArray(scope.workspaceIds, 10, MAX_ID_BYTES, "scope.workspaceIds");
}

function parseWindowSnapshot(value: unknown): void {
  const snapshot = allowedRecord(value, [
    "context",
    "defaultScope",
    "openedAt",
    "source",
    "workspaceOptions",
  ], ["defaultWorkspaceId"]);
  timestamp(snapshot.openedAt, "snapshot.openedAt");
  oneOf(snapshot.source, ["cloud_gated", "home", "settings", "sidebar"], "snapshot.source");
  oneOf(snapshot.defaultScope, [
    "app_only",
    "choose_workspace",
    "most_recent_workspace",
  ], "snapshot.defaultScope");
  optionalNullableBoundedString(
    snapshot.defaultWorkspaceId,
    MAX_ID_BYTES,
    "snapshot.defaultWorkspaceId",
  );
  parseContext(snapshot.context);
  const options = array(
    snapshot.workspaceOptions,
    Number.MAX_SAFE_INTEGER,
    "snapshot.workspaceOptions",
  );
  for (const option of options) parseWorkspaceOption(option);
}

function parseContext(value: unknown): void {
  const context = allowedRecord(value, ["intent", "source"], [
    "pathname",
    "workspaceId",
    "workspaceLocation",
    "workspaceName",
  ]);
  oneOf(context.source, ["cloud_gated", "home", "settings", "sidebar"], "context.source");
  oneOf(context.intent, ["general", "team_features", "unlimited_cloud"], "context.intent");
  optionalNullableBoundedString(context.pathname, MAX_PATH_BYTES, "context.pathname");
  optionalNullableBoundedString(context.workspaceId, MAX_ID_BYTES, "context.workspaceId");
  optionalNullableCharacters(context.workspaceName, 255, "context.workspaceName");
  if (context.workspaceLocation !== undefined && context.workspaceLocation !== null) {
    oneOf(context.workspaceLocation, ["cloud", "local"], "context.workspaceLocation");
  }
}

function parseWorkspaceOption(value: unknown): void {
  const option = allowedRecord(value, ["id", "label", "location"], [
    "anyharnessWorkspaceId",
    "branch",
    "cloudTargetId",
    "cloudWorkspaceId",
    "exposureId",
    "materializationId",
    "path",
    "sandboxProfileId",
    "sandboxType",
    "sessionIds",
    "status",
    "updatedAt",
    "visibility",
  ]);
  boundedString(option.id, 1, MAX_ID_BYTES, "workspace.id");
  boundedCharacters(option.label, 0, 255, "workspace.label");
  oneOf(option.location, ["cloud", "local"], "workspace.location");
  for (const key of [
    "anyharnessWorkspaceId",
    "branch",
    "cloudTargetId",
    "cloudWorkspaceId",
    "exposureId",
    "materializationId",
    "sandboxProfileId",
    "sandboxType",
    "status",
    "visibility",
  ]) {
    optionalNullableBoundedString(option[key], 255, `workspace.${key}`);
  }
  optionalNullableBoundedString(option.path, MAX_PATH_BYTES, "workspace.path");
  if (option.updatedAt !== undefined && option.updatedAt !== null) {
    timestamp(option.updatedAt, "workspace.updatedAt");
  }
  if (option.sessionIds !== undefined) {
    stringArray(option.sessionIds, 20, MAX_ID_BYTES, "workspace.sessionIds");
  }
}

function parseAttachments(value: unknown): SupportReportAttachmentPayload[] {
  const attachments = array(value, MAX_ATTACHMENTS, "attachments");
  let total = 0;
  const ids = new Set<string>();
  for (const value of attachments) {
    const attachment = allowedRecord(value, [
      "clientFileId",
      "contentType",
      "fileName",
      "sizeBytes",
    ], ["dataBase64", "stagedPath"]);
    boundedString(attachment.clientFileId, 1, MAX_ID_BYTES, "attachment.clientFileId");
    boundedCharacters(attachment.fileName, 1, 255, "attachment.fileName");
    boundedCharacters(attachment.contentType, 0, 255, "attachment.contentType");
    safeInteger(attachment.sizeBytes, "attachment.sizeBytes", MAX_ATTACHMENT_BYTES);
    optionalBoundedString(
      attachment.dataBase64,
      MAX_ATTACHMENT_BASE64_BYTES,
      "attachment.dataBase64",
    );
    optionalNullableBoundedString(attachment.stagedPath, MAX_PATH_BYTES, "attachment.stagedPath");
    if (attachment.dataBase64 === undefined && !attachment.stagedPath) invalid("attachment data");
    if (ids.has(attachment.clientFileId as string)) invalid("duplicate attachment");
    ids.add(attachment.clientFileId as string);
    total += attachment.sizeBytes as number;
  }
  if (total > MAX_TOTAL_ATTACHMENT_BYTES) invalid("attachment total");
  return attachments as SupportReportAttachmentPayload[];
}

function parseSnapshotIntent(value: unknown, jobId: string): SupportReportSnapshotIntent {
  const intent = record(value, "supportSnapshot");
  if (intent.kind === "none") {
    exactKeys(intent, ["kind"]);
    return intent as unknown as SupportReportSnapshotIntent;
  }
  exactKeys(intent, ["artifact", "consent", "kind"]);
  if (intent.kind !== "prepared") invalid("supportSnapshot.kind");
  if (!UUID.test(jobId)) invalid("prepared jobId");
  parseConsent(intent.consent);
  parsePreparedArtifact(intent.artifact);
  return intent as unknown as SupportReportSnapshotIntent;
}

function parseConsent(value: unknown): SupportSnapshotConsentV1 {
  const consent = exactRecord(value, ["disclosureVersion", "grantedAt", "selection", "version"]);
  if (consent.version !== 1
    || consent.disclosureVersion !== "desktop_support_snapshot_customer_content_v1") {
    invalid("consent version");
  }
  timestamp(consent.grantedAt, "consent.grantedAt");
  const selection = record(consent.selection, "consent.selection");
  if (selection.kind === "active_session") {
    exactKeys(selection, ["kind", "materializedSessionId", "uiSessionId", "workspace"]);
    boundedString(selection.uiSessionId, 1, MAX_ID_BYTES, "selection.uiSessionId");
    boundedString(
      selection.materializedSessionId,
      1,
      MAX_ID_BYTES,
      "selection.materializedSessionId",
    );
    parseWorkspaceBinding(selection.workspace, false);
  } else if (selection.kind === "recent_activity") {
    exactKeys(selection, ["kind", "workspace"]);
    parseWorkspaceBinding(selection.workspace, true);
  } else {
    invalid("selection.kind");
  }
  return consent as unknown as SupportSnapshotConsentV1;
}

function parseWorkspaceBinding(value: unknown, allowNone: boolean): void {
  const binding = record(value, "selection.workspace");
  if (binding.kind === "bundled_local") {
    exactKeys(binding, ["anyharnessWorkspaceId", "kind", "workspaceId"]);
    boundedString(binding.workspaceId, 1, MAX_ID_BYTES, "binding.workspaceId");
    boundedString(
      binding.anyharnessWorkspaceId,
      1,
      MAX_ID_BYTES,
      "binding.anyharnessWorkspaceId",
    );
  } else if (allowNone && binding.kind === "none") {
    exactKeys(binding, ["kind", "reason"]);
    if (binding.reason !== "no_selected_bundled_local_workspace") invalid("binding.reason");
  } else {
    invalid("binding.kind");
  }
}

function parsePreparedArtifact(value: unknown): PreparedSupportSnapshotV1 {
  const artifact = exactRecord(value, [
    "artifactId",
    "artifactSchemaVersion",
    "generatedAt",
    "preparationOperationId",
    "sha256",
    "sizeBytes",
    "snapshotId",
    "summary",
  ]);
  if (artifact.artifactSchemaVersion !== 3
    || typeof artifact.artifactId !== "string" || !ARTIFACT_ID.test(artifact.artifactId)
    || typeof artifact.sha256 !== "string" || !SHA256.test(artifact.sha256)) {
    invalid("artifact identity");
  }
  boundedString(artifact.snapshotId, 1, MAX_ID_BYTES, "artifact.snapshotId");
  if (typeof artifact.preparationOperationId !== "string"
    || !UUID.test(artifact.preparationOperationId)) {
    invalid("artifact.preparationOperationId");
  }
  timestamp(artifact.generatedAt, "artifact.generatedAt");
  safeInteger(artifact.sizeBytes, "artifact.sizeBytes", MAX_DIAGNOSTICS_BYTES);
  const summary = exactRecord(artifact.summary, [
    "collectorRecords",
    "fallbackRecords",
    "omissions",
    "sessions",
    "truncations",
  ]);
  for (const [key, count] of Object.entries(summary)) safeInteger(count, `summary.${key}`);
  return artifact as unknown as PreparedSupportSnapshotV1;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) invalid(label);
  return value as Record<string, unknown>;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const result = record(value, "record");
  exactKeys(result, keys);
  return result;
}

function allowedRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
): Record<string, unknown> {
  const result = record(value, "record");
  const keys = Object.keys(result);
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(result, key))
    || keys.some((key) => !required.includes(key) && !optional.includes(key))) invalid("keys");
  return result;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length
    || keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) invalid("keys");
}

function array(value: unknown, maximum: number, label: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximum) invalid(label);
  return value;
}

function stringArray(value: unknown, maximum: number, bytes: number, label: string): void {
  for (const item of array(value, maximum, label)) boundedString(item, 1, bytes, label);
}

function boundedString(
  value: unknown,
  minimum: number,
  maximumBytes: number,
  label: string,
): asserts value is string {
  if (typeof value !== "string" || value.length < minimum
    || new TextEncoder().encode(value).byteLength > maximumBytes) invalid(label);
}

function boundedCharacters(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): asserts value is string {
  if (typeof value !== "string") invalid(label);
  let length = 0;
  for (const _character of value) length += 1;
  if (length < minimum || length > maximum) invalid(label);
}

function optionalBoundedString(value: unknown, maximum: number, label: string): void {
  if (value !== undefined) boundedString(value, 0, maximum, label);
}

function optionalNullableCharacters(value: unknown, maximum: number, label: string): void {
  if (value !== undefined && value !== null) boundedCharacters(value, 0, maximum, label);
}

function optionalNullableBoundedString(value: unknown, maximum: number, label: string): void {
  if (value !== undefined && value !== null) boundedString(value, 0, maximum, label);
}

function boolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== "boolean") invalid(label);
}

function optionalBoolean(value: unknown, label: string): void {
  if (value !== undefined) boolean(value, label);
}

function safeInteger(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0
    || value > maximum || Object.is(value, -0)) invalid(label);
}

function timestamp(value: unknown, label: string): asserts value is string {
  boundedString(value, 1, 64, label);
  if (!Number.isFinite(Date.parse(value))) invalid(label);
}

function optionalTimestamp(value: unknown, label: string): void {
  if (value !== undefined) timestamp(value, label);
}

function nullableTimestamp(value: unknown, label: string): void {
  if (value !== null) timestamp(value, label);
}

function nullableBoundedString(value: unknown, maximum: number, label: string): void {
  if (value !== null) boundedString(value, 0, maximum, label);
}

function nullableFailureKind(value: unknown, label: string): void {
  if (value !== null) boundedString(value, 1, 128, label);
}

function oneOf(value: unknown, values: readonly string[], label: string): void {
  if (typeof value !== "string" || !values.includes(value)) invalid(label);
}

function invalid(label: string): never {
  throw new Error(`Invalid persisted support report ${label}.`);
}
