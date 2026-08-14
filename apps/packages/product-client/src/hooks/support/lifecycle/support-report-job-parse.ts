import type {
  PreparedSupportSnapshotV1,
  SupportSnapshotConsentV1,
} from "@proliferate/product-client/host/desktop-bridge";
import type {
  SupportReportAttachmentPayload,
  SupportReportJob,
  SupportReportSnapshotIntent,
} from "#product/lib/domain/support/report-types";

import {
  ARTIFACT_ID,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BASE64_BYTES,
  MAX_ATTACHMENT_BYTES,
  MAX_CREDIT_NAME_CHARACTERS,
  MAX_DIAGNOSTICS_BYTES,
  MAX_ID_BYTES,
  MAX_MESSAGE_CHARACTERS,
  MAX_PATH_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
  SHA256,
  UUID,
  allowedRecord,
  array,
  boolean,
  boundedCharacters,
  boundedString,
  exactKeys,
  exactRecord,
  invalid,
  oneOf,
  optionalBoolean,
  optionalBoundedString,
  optionalNullableBoundedString,
  optionalNullableCharacters,
  optionalTimestamp,
  record,
  safeInteger,
  stringArray,
  timestamp,
} from "./support-report-job-scalars";

export function parseSupportReportJob(value: unknown): SupportReportJob {
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
