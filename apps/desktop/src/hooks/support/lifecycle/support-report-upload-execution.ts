import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import type { ProliferateCloudClient } from "@proliferate/cloud-sdk";
import {
  completeSupportReportUpload,
  createSupportReport,
  createSupportReportUploadTargets,
} from "@proliferate/cloud-sdk/client/support";
import type {
  SupportReportCompleteRequest,
  SupportReportUploadTargetsRequest,
} from "@proliferate/cloud-sdk/types";
import type { DesktopDiagnosticsBridge } from "@proliferate/product-client/host/desktop-diagnostics-bridge";

import type { ProductTelemetryFacade } from "@/hooks/telemetry/facade/use-product-telemetry";
import type { SupportReportJob } from "@/lib/domain/support/report-types";
import type { SupportReportUploadDependencies } from "@/lib/workflows/support/support-report-upload-workflows";
import { buildSupportReportPackage } from "@/lib/workflows/support/support-report-upload-workflows";
import { deleteSupportReportJobAttachments } from "./support-report-upload-persistence";
import {
  attachmentUploadFiles,
  buildCreateReportRequest,
  completeRequestForUpload,
  DIAGNOSTICS_MAX_BYTES,
  jsonBlob,
  loadAttachmentBlob,
  putPresignedObject,
  sha256Hex,
  toLocalServerCorrelation,
  trackSupportReportSubmitted,
  validateAttachmentSizes,
} from "./support-report-upload-payload";

export interface SupportReportUploadResult {
  reportId: string;
}

export async function uploadSupportReport(
  job: SupportReportJob,
  dependencies: SupportReportUploadDependencies<AnyHarnessResolvedConnection>,
  diagnostics: DesktopDiagnosticsBridge | null,
  cloudClient: ProliferateCloudClient,
  telemetry: ProductTelemetryFacade,
): Promise<SupportReportUploadResult> {
  validateAttachmentSizes(job);
  const report = await createSupportReport(
    buildCreateReportRequest(
      job,
      job.attachments.length,
      telemetry.getSupportContext(),
    ),
    cloudClient,
  );
  const serverCorrelation = toLocalServerCorrelation(report);
  if (report.status === "completed") {
    trackSupportReportSubmitted(
      job,
      serverCorrelation,
      job.attachments.length,
      telemetry.track,
    );
    await deleteSupportReportJobAttachments(job, diagnostics?.deleteAttachment);
    return { reportId: report.reportId };
  }

  const includeLogs = job.includeLogs !== false;
  const attachmentBlobs = await Promise.all(job.attachments.map(async (attachment) => ({
    attachment,
    blob: await loadAttachmentBlob(attachment, diagnostics?.readAttachment),
  })));
  const attachmentHashes = await Promise.all(attachmentBlobs.map(async ({ blob }) =>
    sha256Hex(await blob.arrayBuffer())
  ));

  let diagnosticsUpload:
    | { blob: Blob; sha256: string; generatedAt: string }
    | null = null;
  if (includeLogs) {
    const reportPackage = await buildSupportReportPackage(
      job,
      dependencies,
      serverCorrelation,
    );
    const diagnosticsBlob = jsonBlob(reportPackage);
    if (diagnosticsBlob.size > DIAGNOSTICS_MAX_BYTES) {
      throw new Error("Diagnostics are too large to upload.");
    }
    diagnosticsUpload = {
      blob: diagnosticsBlob,
      sha256: await sha256Hex(await diagnosticsBlob.arrayBuffer()),
      generatedAt: reportPackage.generatedAt,
    };
  }

  if (!diagnosticsUpload && attachmentBlobs.length === 0) {
    const completeRequest = completeRequestForUpload({
      job,
      reportId: report.reportId,
      diagnostics: undefined,
      generatedAt: dependencies.now().toISOString(),
      cloudDiagnosticsStatus: report.cloudDiagnosticsStatus,
      attachments: [],
    });
    await completeSupportReportUpload(
      report.reportId,
      completeRequest,
      cloudClient,
    );
    trackSupportReportSubmitted(job, serverCorrelation, 0, telemetry.track);
    await deleteSupportReportJobAttachments(job, diagnostics?.deleteAttachment);
    return { reportId: report.reportId };
  }

  const uploadRequest: SupportReportUploadTargetsRequest = {
    diagnostics: diagnosticsUpload
      ? {
          contentType: "application/json",
          sizeBytes: diagnosticsUpload.blob.size,
          sha256: diagnosticsUpload.sha256,
        }
      : undefined,
    attachments: attachmentUploadFiles(attachmentBlobs, attachmentHashes),
  };
  const upload = await createSupportReportUploadTargets(
    report.reportId,
    uploadRequest,
    cloudClient,
  );
  if (diagnosticsUpload) {
    if (!upload.diagnostics) {
      throw new Error("Cloud did not return a diagnostics upload URL.");
    }
    await putPresignedObject(upload.diagnostics, diagnosticsUpload.blob);
  }

  const completedAttachments: NonNullable<SupportReportCompleteRequest["attachments"]> = [];
  for (const [index, item] of attachmentBlobs.entries()) {
    const target = (upload.attachments ?? []).find((candidate) =>
      candidate.clientFileId === item.attachment.clientFileId
    );
    if (!target) {
      throw new Error(`Cloud did not return an upload URL for ${item.attachment.fileName}.`);
    }
    await putPresignedObject(target, item.blob);
    completedAttachments.push({
      objectKey: target.objectKey,
      sha256: attachmentHashes[index] ?? "",
      sizeBytes: item.blob.size,
    });
  }

  const completeRequest = completeRequestForUpload({
    job,
    reportId: report.reportId,
    diagnostics: diagnosticsUpload && upload.diagnostics
      ? {
          objectKey: upload.diagnostics.objectKey,
          sha256: diagnosticsUpload.sha256,
          sizeBytes: diagnosticsUpload.blob.size,
        }
      : undefined,
    generatedAt: diagnosticsUpload?.generatedAt ?? dependencies.now().toISOString(),
    cloudDiagnosticsStatus: report.cloudDiagnosticsStatus,
    attachments: completedAttachments,
  });
  await completeSupportReportUpload(
    upload.reportId,
    completeRequest,
    cloudClient,
  );
  trackSupportReportSubmitted(
    job,
    serverCorrelation,
    completedAttachments.length,
    telemetry.track,
  );
  await deleteSupportReportJobAttachments(job, diagnostics?.deleteAttachment);
  return { reportId: upload.reportId };
}
