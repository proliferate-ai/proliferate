import {
  completeSupportReportUpload,
  createSupportReport,
  createSupportReportUploadTargets,
} from "@proliferate/cloud-sdk/client/support";
import type {
  SupportReportCompleteRequest,
  SupportReportCreateResponse,
  SupportReportUploadTargetsRequest,
} from "@proliferate/cloud-sdk/types";
import type {
  DesktopDiagnosticsBridge,
  DesktopSupportSnapshotBridge,
  FinishSupportSnapshotSubmissionInputV1,
} from "@proliferate/product-client/host/desktop-bridge";
import type { ProductSupportTelemetryContext } from "@proliferate/product-client/host/product-host";
import type { DesktopProductEventMap } from "#product/lib/domain/telemetry/events";
import type { SupportReportJob } from "#product/lib/domain/support/report-types";
import {
  describeSupportReportUploadFailure,
  SupportSnapshotArtifactError,
  type SupportReportUploadFailureKind,
} from "#product/lib/domain/support/report-upload-failure";

import { readVerifiedSupportSnapshot } from "./support-report-upload-artifact";
import {
  attachmentUploadFiles,
  buildCreateReportRequest,
  completeRequestForUpload,
  loadAttachmentBlob,
  putPresignedObject,
  sha256Hex,
  toLocalServerCorrelation,
  trackSupportReportSubmitted,
  validateAttachmentSizes,
} from "./support-report-upload-payload";

export interface SupportReportUploadTelemetry {
  track: (
    name: "support_report_submitted",
    payload: DesktopProductEventMap["support_report_submitted"],
  ) => void;
  getSupportContext: () => ProductSupportTelemetryContext;
}

interface SupportReportUploadResult {
  reportId: string;
}

export async function uploadSupportReportAttempt(input: {
  job: SupportReportJob;
  attempt: number;
  diagnostics: DesktopDiagnosticsBridge | null;
  supportSnapshot: DesktopSupportSnapshotBridge | null;
  telemetry: SupportReportUploadTelemetry;
  retainBytes(blob: Blob): void;
  onLifecycleError(error: unknown): void;
}): Promise<SupportReportUploadResult> {
  const prepared = input.job.supportSnapshot.kind === "prepared"
    ? await verifyPreparedSnapshot(input.job, input.supportSnapshot)
    : null;
  if (prepared) input.retainBytes(prepared.blob);

  let submission: { submissionId: string; operationId: string } | null = null;
  let finishAttempted = false;
  let reportId: string | null = null;
  try {
    if (prepared && input.supportSnapshot) {
      submission = await input.supportSnapshot.beginSubmission({
        artifactId: prepared.artifact.artifactId,
        clientJobId: input.job.jobId,
        attempt: input.attempt,
        parentOperationId: prepared.artifact.preparationOperationId,
      });
    }
    validateAttachmentSizes(input.job);
    const report = await createSupportReport(buildCreateReportRequest(
      input.job,
      input.job.attachments.length,
      input.telemetry.getSupportContext(),
    ));
    reportId = report.reportId;
    const result = await uploadAfterCreate(input, report, prepared);
    if (submission && input.supportSnapshot) {
      finishAttempted = true;
      try {
        await input.supportSnapshot.finishSubmission({
          submissionId: submission.submissionId,
          outcome: "succeeded",
          reportId,
        });
      } catch (lifecycleError) {
        reportLifecycleError(input.onLifecycleError, lifecycleError);
      }
    }
    return result;
  } catch (error) {
    if (submission && input.supportSnapshot && !finishAttempted) {
      const terminal = submissionTerminal(
        submission.submissionId,
        error,
        input.attempt,
        reportId,
      );
      try {
        finishAttempted = true;
        await input.supportSnapshot.finishSubmission(terminal);
      } catch (lifecycleError) {
        reportLifecycleError(input.onLifecycleError, lifecycleError);
      }
    }
    throw error;
  }
}

async function verifyPreparedSnapshot(
  job: SupportReportJob,
  bridge: DesktopSupportSnapshotBridge | null,
) {
  if (job.supportSnapshot.kind !== "prepared") return null;
  if (!bridge) throw new SupportSnapshotArtifactError("snapshot_missing");
  return readVerifiedSupportSnapshot(bridge, job.supportSnapshot.artifact);
}

async function uploadAfterCreate(
  input: Parameters<typeof uploadSupportReportAttempt>[0],
  report: SupportReportCreateResponse,
  prepared: Awaited<ReturnType<typeof readVerifiedSupportSnapshot>> | null,
): Promise<SupportReportUploadResult> {
  const serverCorrelation = toLocalServerCorrelation(report);
  if (report.status === "completed") {
    if (input.job.includeLogs === true && input.job.supportSnapshot.kind === "none") {
      throw Object.assign(
        new Error("This legacy report was completed with an earlier diagnostics intent."),
        { code: "consent_required_for_legacy_job" },
      );
    }
    trackSupportReportSubmitted(
      input.job,
      serverCorrelation,
      input.job.attachments.length,
      prepared !== null,
      input.telemetry.track,
    );
    return { reportId: report.reportId };
  }

  const attachmentBlobs = await Promise.all(input.job.attachments.map(async (attachment) => {
    const blob = await loadAttachmentBlob(attachment, input.diagnostics?.readAttachment);
    input.retainBytes(blob);
    return { attachment, blob };
  }));
  const attachmentHashes = await Promise.all(attachmentBlobs.map(async ({ blob }) =>
    sha256Hex(await blob.arrayBuffer())
  ));

  if (!prepared && attachmentBlobs.length === 0 && input.job.includeLogs !== true) {
    await completeSupportReportUpload(report.reportId, completeRequestForUpload({
      job: input.job,
      reportId: report.reportId,
      diagnostics: undefined,
      generatedAt: new Date().toISOString(),
      cloudDiagnosticsStatus: report.cloudDiagnosticsStatus,
      attachments: [],
    }));
    trackSupportReportSubmitted(
      input.job,
      serverCorrelation,
      0,
      false,
      input.telemetry.track,
    );
    return { reportId: report.reportId };
  }

  const uploadRequest: SupportReportUploadTargetsRequest = {
    diagnostics: prepared
      ? {
          contentType: "application/json",
          sizeBytes: prepared.blob.size,
          sha256: prepared.sha256,
        }
      : undefined,
    attachments: attachmentUploadFiles(attachmentBlobs, attachmentHashes),
  };
  const upload = await createSupportReportUploadTargets(report.reportId, uploadRequest);
  if (prepared) {
    if (!upload.diagnostics) throw uploadRejected("Cloud did not return a diagnostics upload URL.");
    await putPresignedObject(upload.diagnostics, prepared.blob);
  }

  const completedAttachments: NonNullable<SupportReportCompleteRequest["attachments"]> = [];
  for (const [index, item] of attachmentBlobs.entries()) {
    const target = (upload.attachments ?? []).find((candidate) =>
      candidate.clientFileId === item.attachment.clientFileId
    );
    if (!target) {
      throw uploadRejected(`Cloud did not return an upload URL for ${item.attachment.fileName}.`);
    }
    await putPresignedObject(target, item.blob);
    completedAttachments.push({
      objectKey: target.objectKey,
      sha256: attachmentHashes[index] ?? "",
      sizeBytes: item.blob.size,
    });
  }

  await completeSupportReportUpload(upload.reportId, completeRequestForUpload({
    job: input.job,
    reportId: report.reportId,
    diagnostics: prepared && upload.diagnostics
      ? {
          objectKey: upload.diagnostics.objectKey,
          sha256: prepared.sha256,
          sizeBytes: prepared.blob.size,
        }
      : undefined,
    generatedAt: prepared?.artifact.generatedAt ?? new Date().toISOString(),
    cloudDiagnosticsStatus: report.cloudDiagnosticsStatus,
    attachments: completedAttachments,
  }));
  trackSupportReportSubmitted(
    input.job,
    serverCorrelation,
    completedAttachments.length,
    prepared !== null,
    input.telemetry.track,
  );
  return { reportId: upload.reportId };
}

function submissionTerminal(
  submissionId: string,
  error: unknown,
  attempt: number,
  reportId: string | null,
): FinishSupportSnapshotSubmissionInputV1 {
  const kind = describeSupportReportUploadFailure(error, attempt).kind;
  return submissionTerminalForFailure(submissionId, kind, reportId);
}

function submissionTerminalForFailure(
  submissionId: string,
  kind: SupportReportUploadFailureKind | "upload_timeout",
  reportId: string | null,
): FinishSupportSnapshotSubmissionInputV1 {
  const base = { submissionId, reportId };
  switch (kind) {
    case "already_completed":
      return { ...base, outcome: "succeeded" };
    case "local_payload_invalid":
      return { ...base, outcome: "rejected", errorClassification: "local_payload_invalid" };
    case "upload_conflict":
      return { ...base, outcome: "rejected", errorClassification: "upload_conflict" };
    case "upload_rejected":
      return { ...base, outcome: "rejected", errorClassification: "upload_rejected" };
    case "upload_timeout":
      // Dormant by contract: this slice owns no end-to-end duration/cancel
      // seam, so no observed transport exception is classified as timeout.
      return { ...base, outcome: "timed_out", errorClassification: "upload_timeout" };
    case "auth_required":
    case "cloud_unconfigured":
    case "dev_auth_bypass":
    case "storage_unconfigured":
    case "transient":
      return { ...base, outcome: "failed", errorClassification: kind };
    case "snapshot_missing":
    case "snapshot_mismatch":
      // Verification happens before submission admission. Reaching this branch
      // would violate that boundary, so close the admitted operation as an
      // ordinary transient failure without widening the native vocabulary.
      return { ...base, outcome: "failed", errorClassification: "transient" };
  }
}

function uploadRejected(message: string): Error & { code: string; status: number } {
  return Object.assign(new Error(message), {
    code: "support_report_upload_invalid",
    status: 400,
  });
}

export function legacyConsentRequired(error: unknown, job: SupportReportJob): boolean {
  if (job.includeLogs !== true || job.supportSnapshot.kind !== "none") return false;
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "consent_required_for_legacy_job") return true;
  const failure = describeSupportReportUploadFailure(error, 1).kind;
  const message = error instanceof Error
    ? error.message
    : (error as { message?: unknown } | null)?.message;
  return failure === "upload_conflict"
    && typeof message === "string"
    && message.toLowerCase().includes("diagnostics intent");
}

function reportLifecycleError(
  onLifecycleError: (error: unknown) => void,
  error: unknown,
): void {
  try {
    onLifecycleError(error);
  } catch {
    // Lifecycle evidence is observational and cannot change report delivery.
  }
}
