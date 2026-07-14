import {
  resolveWorkspaceConnectionFromContext,
  useAnyHarnessWorkspaceContext,
  type AnyHarnessResolvedConnection,
} from "@anyharness/sdk-react";
import { useEffect, useMemo, useRef } from "react";
import type { DesktopDiagnosticsBridge } from "@proliferate/product-client/host/desktop-bridge";
import type { ProductSupportTelemetryContext } from "@proliferate/product-client/host/product-host";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useProductTelemetry } from "@/hooks/telemetry/facade/use-product-telemetry";
import { useProductStorageContext } from "@/hooks/persistence/facade/use-product-storage-context";
import type { DesktopProductEventMap } from "@/lib/domain/telemetry/events";
import type { ProductStorageContext } from "@/lib/infra/persistence/product-storage";
import {
  completeSupportReportUpload,
  createSupportReport,
  createSupportReportUploadTargets,
} from "@proliferate/cloud-sdk/client/support";
import type {
  SupportReportCompleteRequest,
  SupportReportUploadTargetsRequest,
} from "@proliferate/cloud-sdk/types";
import { listenSupportReportJobs } from "@/lib/access/browser/support-report-job-events";
import { createSessionDebugClient } from "@/lib/access/anyharness/debug-client";
import type {
  SupportReportJob,
} from "@/lib/domain/support/report-types";
import {
  describeSupportReportUploadFailure,
  shouldShowSupportReportUploadFailureToast,
  supportReportRetriesExhausted,
} from "@/lib/domain/support/report-upload-failure";
import {
  buildSupportReportPackage,
  type SupportReportUploadDependencies,
} from "@/lib/workflows/support/support-report-upload-workflows";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  deleteSupportReportJobAttachments,
  markPersistedJobFailed,
  persistSupportReportJob,
  readPersistedJobs,
  removePersistedJob,
  scheduleNextRetry,
} from "./support-report-upload-persistence";
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

interface SupportReportUploadResult {
  reportId: string;
}

/**
 * The narrow product telemetry surface this queue threads into its plain payload
 * builders: the typed `support_report_submitted` emitter and the support-context
 * accessor, both obtained from the `useProductTelemetry` facade.
 */
interface SupportReportUploadTelemetry {
  track: (
    name: "support_report_submitted",
    payload: DesktopProductEventMap["support_report_submitted"],
  ) => void;
  getSupportContext: () => ProductSupportTelemetryContext;
}

export function useSupportReportUploadQueue(): void {
  const diagnostics = useProductHost().desktop?.diagnostics ?? null;
  const telemetry = useProductTelemetry();
  const storage = useProductStorageContext();
  const workspaceContext = useAnyHarnessWorkspaceContext();
  const contextWorkspaceId = workspaceContext.workspaceId;
  const resolveConnection = workspaceContext.resolveConnection;
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const showToast = useToastStore((state) => state.show);
  const processingRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);

  const dependencies = useMemo<
    SupportReportUploadDependencies<AnyHarnessResolvedConnection>
  >(() => ({
    now: () => new Date(),
    collectDiagnostics: () => diagnostics?.collectSupportBundle() ?? Promise.resolve(null),
    resolveWorkspace: (workspaceId) => resolveWorkspaceConnectionFromContext(
      {
        workspaceId: contextWorkspaceId,
        resolveConnection,
      },
      workspaceId,
    ),
    getClient: createSessionDebugClient,
  }), [contextWorkspaceId, diagnostics, resolveConnection, runtimeUrl]);

  useEffect(() => {
    let disposed = false;
    let unlistenJobs: (() => void) | null = null;
    // Persisting is async now, so chain deliveries to preserve the synchronous
    // dedup the old localStorage path had: a rapid double-delivery of the same
    // job must read the first write before the second persist runs. This is a
    // per-mount ordering of this listener's own writes, not a retry/queue system.
    let persistChain: Promise<void> = Promise.resolve();

    const processQueue = () => {
      if (disposed || processingRef.current) {
        return;
      }
      processingRef.current = true;
      void drainSupportReportQueue(storage, dependencies, diagnostics, showToast, telemetry)
        .finally(() => {
          processingRef.current = false;
          if (!disposed) {
            void scheduleNextRetry(storage, processQueue, retryTimerRef);
          }
        });
    };

    void listenSupportReportJobs((job) => {
      if (disposed) {
        return;
      }
      persistChain = persistChain.then(async () => {
        if (disposed) {
          return;
        }
        const queued = await persistSupportReportJob(storage, job);
        if (disposed || !queued) {
          return;
        }
        showToast("Sending report...", "info");
        processQueue();
      });
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlistenJobs = unlisten;
      processQueue();
    });

    return () => {
      disposed = true;
      unlistenJobs?.();
      if (retryTimerRef.current != null) {
        window.clearTimeout(retryTimerRef.current);
      }
    };
  }, [dependencies, diagnostics, showToast, storage, telemetry]);
}

async function drainSupportReportQueue(
  storage: ProductStorageContext,
  dependencies: SupportReportUploadDependencies<AnyHarnessResolvedConnection>,
  diagnostics: DesktopDiagnosticsBridge | null,
  showToast: (message: string, type?: "error" | "info") => void,
  telemetry: SupportReportUploadTelemetry,
): Promise<void> {
  const queued = await readPersistedJobs(storage);
  const now = Date.now();
  for (const entry of queued) {
    const nextAttemptMs = entry.nextAttemptAt ? Date.parse(entry.nextAttemptAt) : 0;
    if (Number.isFinite(nextAttemptMs) && nextAttemptMs > now) {
      continue;
    }

    try {
      const result = await uploadSupportReport(entry.job, dependencies, diagnostics, telemetry);
      await removePersistedJob(storage, entry.job.jobId);
      showToast(
        `Thanks. Report sent. Support has the details. (${result.reportId})`,
        "info",
      );
    } catch (error) {
      const attemptCount = entry.attemptCount + 1;
      const failure = describeSupportReportUploadFailure(error, attemptCount);
      void diagnostics?.logEvent({
        source: "support_report_upload",
        message: `failed.${failure.kind}`,
      });

      // Already completed on a prior attempt — this is success, not failure.
      // Clean up the queued job quietly instead of nagging.
      if (failure.kind === "already_completed") {
        await removePersistedJob(storage, entry.job.jobId);
        await deleteSupportReportJobAttachments(
          entry.job,
          diagnostics?.deleteAttachment,
        );
        showToast(failure.toastMessage, "info");
        continue;
      }

      // Drop only when retries are exhausted: a transient failure that spent its
      // attempt budget, or any retryable failure (incl. blocked-on-user/config
      // states) that has aged past the backstop. Blocked states are not
      // attempt-capped, so they stay queued for the user instead of being lost.
      const exhausted = supportReportRetriesExhausted({
        kind: failure.kind,
        attemptCount,
        createdAt: entry.job.createdAt,
        nowMs: Date.now(),
      });
      if (!failure.retryable || exhausted) {
        await removePersistedJob(storage, entry.job.jobId);
        await deleteSupportReportJobAttachments(
          entry.job,
          diagnostics?.deleteAttachment,
        );
        if (exhausted) {
          void diagnostics?.logEvent({
            source: "support_report_upload",
            message: "dropped.exhausted",
          });
          showToast(
            "Couldn't send your report after several tries. Please try again from Help.",
          );
        } else {
          showToast(failure.toastMessage);
        }
        continue;
      }

      const nowMs = Date.now();
      const shouldToast = shouldShowSupportReportUploadFailureToast({
        failure,
        lastToastAt: entry.lastFailureToastAt,
        lastToastKind: entry.lastFailureToastKind,
        nowMs,
      });
      await markPersistedJobFailed(storage, entry.job.jobId, failure, new Date(nowMs), shouldToast);
      if (shouldToast) {
        showToast(failure.toastMessage);
      }
    }
  }
}

async function uploadSupportReport(
  job: SupportReportJob,
  dependencies: SupportReportUploadDependencies<AnyHarnessResolvedConnection>,
  diagnostics: DesktopDiagnosticsBridge | null,
  telemetry: SupportReportUploadTelemetry,
): Promise<SupportReportUploadResult> {
  validateAttachmentSizes(job);
  const report = await createSupportReport(
    buildCreateReportRequest(job, job.attachments.length, telemetry.getSupportContext()),
  );
  const serverCorrelation = toLocalServerCorrelation(report);
  if (report.status === "completed") {
    trackSupportReportSubmitted(job, serverCorrelation, job.attachments.length, telemetry.track);
    await deleteSupportReportJobAttachments(job, diagnostics?.deleteAttachment);
    return {
      reportId: report.reportId,
    };
  }

  // "Include app logs" toggle (bug modal): when OFF, we neither collect nor
  // upload diagnostics.json for this job. Defaults to ON for jobs persisted
  // before the toggle existed.
  const includeLogs = job.includeLogs !== false;

  const attachmentBlobs = await Promise.all(job.attachments.map(async (attachment) => ({
    attachment,
    blob: await loadAttachmentBlob(attachment, diagnostics?.readAttachment),
  })));
  const attachmentHashes = await Promise.all(attachmentBlobs.map(async ({ blob }) =>
    sha256Hex(await blob.arrayBuffer())
  ));

  // Only collect/build the diagnostics package when logs are included.
  let diagnosticsUpload:
    | { blob: Blob; sha256: string; generatedAt: string }
    | null = null;
  if (includeLogs) {
    const reportPackage = await buildSupportReportPackage(job, dependencies, serverCorrelation);
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

  // Logs off + no attachments: nothing to upload. Complete directly — the
  // server allows completion without an upload-target manifest when the
  // expected upload intent is diagnostics=false and attachmentCount=0.
  if (!diagnosticsUpload && attachmentBlobs.length === 0) {
    const completeRequest = completeRequestForUpload({
      job,
      reportId: report.reportId,
      diagnostics: undefined,
      generatedAt: dependencies.now().toISOString(),
      cloudDiagnosticsStatus: report.cloudDiagnosticsStatus,
      attachments: [],
    });
    await completeSupportReportUpload(report.reportId, completeRequest);
    trackSupportReportSubmitted(job, serverCorrelation, 0, telemetry.track);
    await deleteSupportReportJobAttachments(job, diagnostics?.deleteAttachment);
    return {
      reportId: report.reportId,
    };
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

  const upload = await createSupportReportUploadTargets(report.reportId, uploadRequest);
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
  await completeSupportReportUpload(upload.reportId, completeRequest);
  trackSupportReportSubmitted(job, serverCorrelation, completedAttachments.length, telemetry.track);
  await deleteSupportReportJobAttachments(job, diagnostics?.deleteAttachment);
  return {
    reportId: upload.reportId,
  };
}
