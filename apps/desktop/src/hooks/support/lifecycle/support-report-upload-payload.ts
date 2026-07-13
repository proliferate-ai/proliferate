import type {
  SupportReportCompleteRequest,
  SupportReportCreateRequest,
  SupportReportCreateResponse,
  SupportReportUploadFile,
  SupportReportUploadResponse,
} from "@proliferate/cloud-sdk/types";
import {
  readStagedSupportReportAttachment,
} from "@/lib/access/tauri/support";
import type {
  SupportReportJob,
  SupportReportServerCorrelation,
  SupportReportWorkspaceOption,
} from "@/lib/domain/support/report-types";
import {
  getSupportReportReleaseId,
  getSupportReportTelemetryRefs,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";

export const DIAGNOSTICS_MAX_BYTES = 25 * 1024 * 1024;
const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
const TOTAL_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;

export function buildCreateReportRequest(
  job: SupportReportJob,
  attachmentCount: number,
): SupportReportCreateRequest {
  return {
    clientJobId: job.jobId,
    message: job.message,
    sourceSurface: "desktop",
    context: job.snapshot.context,
    scope: job.scope,
    workspaceRefs: workspaceRefsForJob(job),
    telemetryRefs: getSupportReportTelemetryRefs(),
    expectedClientUploads: {
      diagnostics: job.includeLogs !== false,
      attachmentCount,
    },
    publicContentConsent: false,
    kind: job.kind ?? "bug",
    creditConsent: job.creditConsent ?? false,
    creditName: job.creditName ?? null,
    clientReleaseId: getSupportReportReleaseId(),
    urgent: job.urgent ?? false,
    notifyMe: job.notifyMe ?? false,
  };
}

export function attachmentUploadFiles(
  attachmentBlobs: Array<{
    attachment: SupportReportJob["attachments"][number];
    blob: Blob;
  }>,
  attachmentHashes: string[],
): SupportReportUploadFile[] {
  return attachmentBlobs.map(({ attachment, blob }, index) => ({
    clientFileId: attachment.clientFileId,
    fileName: attachment.fileName,
    contentType: attachment.contentType || "application/octet-stream",
    sizeBytes: blob.size,
    sha256: attachmentHashes[index] ?? "",
  }));
}

export function toLocalServerCorrelation(
  response: SupportReportCreateResponse,
): SupportReportServerCorrelation {
  return {
    reportId: response.serverCorrelation.reportId,
    requestId: response.serverCorrelation.requestId ?? null,
    ownerUserId: response.serverCorrelation.ownerUserId,
    primaryOrganizationId: response.serverCorrelation.primaryOrganizationId ?? null,
    primaryTenantId: response.serverCorrelation.primaryTenantId,
    tenantIds: response.serverCorrelation.tenantIds ?? [],
    cloudWorkspaceIds: response.serverCorrelation.cloudWorkspaceIds ?? [],
    cloudTargetIds: response.serverCorrelation.cloudTargetIds ?? [],
    anyharnessWorkspaceIds: response.serverCorrelation.anyharnessWorkspaceIds ?? [],
    sessionIds: response.serverCorrelation.sessionIds ?? [],
  };
}

export function trackSupportReportSubmitted(
  job: SupportReportJob,
  correlation: SupportReportServerCorrelation,
  attachmentCount: number,
): void {
  const workspaceIds = workspaceIdsForJob(job);
  trackProductEvent("support_report_submitted", {
    source_surface: "desktop",
    scope_kind: job.scope.kind,
    public_content_consent: job.publicContentConsent !== false,
    diagnostics_included: job.includeLogs !== false,
    attachment_count: attachmentCount,
    workspace_count: workspaceIds.length,
    cloud_workspace_count: correlation.cloudWorkspaceIds.length,
  });
}

export async function putPresignedObject(
  target: SupportReportUploadResponse["diagnostics"],
  blob: Blob,
): Promise<void> {
  if (!target) {
    throw new Error("Missing upload target.");
  }
  const response = await fetch(target.putUrl, {
    method: "PUT",
    headers: {
      "content-type": target.contentType,
      ...(target.headers ?? {}),
    },
    body: blob,
  });
  if (!response.ok) {
    throw new Error(`Upload failed with ${response.status}.`);
  }
}

export function validateAttachmentSizes(job: SupportReportJob): void {
  let total = 0;
  for (const attachment of job.attachments) {
    if (attachment.sizeBytes > ATTACHMENT_MAX_BYTES) {
      throw new Error(`Attachment is too large: ${attachment.fileName}`);
    }
    total += attachment.sizeBytes;
  }
  if (total > TOTAL_ATTACHMENT_MAX_BYTES) {
    throw new Error("Attachments are too large.");
  }
}

export function jsonBlob(value: unknown): Blob {
  return new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
}

export async function loadAttachmentBlob(
  attachment: SupportReportJob["attachments"][number],
): Promise<Blob> {
  const dataBase64 = attachment.dataBase64
    ?? (
      attachment.stagedPath
        ? await readStagedSupportReportAttachment(attachment.stagedPath)
        : null
    );
  if (!dataBase64) {
    throw new Error(`Attachment data is missing: ${attachment.fileName}`);
  }
  return base64Blob(dataBase64, attachment.contentType);
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function completeRequestForUpload(input: {
  job: SupportReportJob;
  reportId: string;
  /**
   * Diagnostics object metadata. Omitted (undefined) when the submitter turned
   * off "Include app logs" so no diagnostics.json was uploaded for this report.
   */
  diagnostics?: {
    objectKey: string;
    sha256: string;
    sizeBytes: number;
  };
  generatedAt: string;
  cloudDiagnosticsStatus: unknown;
  attachments: NonNullable<SupportReportCompleteRequest["attachments"]>;
}): SupportReportCompleteRequest {
  return {
    diagnostics: input.diagnostics
      ? {
          objectKey: input.diagnostics.objectKey,
          sha256: input.diagnostics.sha256,
          sizeBytes: input.diagnostics.sizeBytes,
        }
      : null,
    attachments: input.attachments,
    packageManifest: {
      schemaVersion: 2,
      jobId: input.job.jobId,
      reportId: input.reportId,
      generatedAt: input.generatedAt,
      diagnosticsBytes: input.diagnostics?.sizeBytes ?? 0,
      diagnosticsIncluded: input.diagnostics != null,
      attachmentCount: input.attachments.length,
      cloudDiagnosticsStatus: input.cloudDiagnosticsStatus,
    },
  };
}

function workspaceRefsForJob(
  job: SupportReportJob,
): NonNullable<SupportReportCreateRequest["workspaceRefs"]> {
  const selectedIds = workspaceIdsForJob(job);
  const byId = new Map(job.snapshot.workspaceOptions.map((workspace) => [workspace.id, workspace]));
  return selectedIds.map((workspaceId) => workspaceRefFromOption(
    byId.get(workspaceId) ?? fallbackWorkspaceOption(workspaceId),
  ));
}

function workspaceRefFromOption(
  workspace: SupportReportWorkspaceOption,
): NonNullable<SupportReportCreateRequest["workspaceRefs"]>[number] {
  return {
    id: workspace.id,
    location: workspace.location,
    cloudWorkspaceId: workspace.cloudWorkspaceId ?? undefined,
    cloudTargetId: workspace.cloudTargetId ?? undefined,
    sandboxProfileId: workspace.sandboxProfileId ?? undefined,
    anyharnessWorkspaceId: workspace.anyharnessWorkspaceId ?? undefined,
    exposureId: workspace.exposureId ?? undefined,
    materializationId: workspace.materializationId ?? undefined,
    sessionIds: workspace.sessionIds ?? [],
    status: workspace.status ?? undefined,
    visibility: workspace.visibility ?? undefined,
    sandboxType: workspace.sandboxType ?? undefined,
  };
}

function fallbackWorkspaceOption(workspaceId: string): SupportReportWorkspaceOption {
  const isCloud = workspaceId.startsWith("cloud:");
  return {
    id: workspaceId,
    label: workspaceId,
    location: isCloud ? "cloud" : "local",
    cloudWorkspaceId: isCloud ? workspaceId.slice("cloud:".length) : null,
  };
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

function base64Blob(dataBase64: string, contentType: string): Blob {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: contentType || "application/octet-stream" });
}
