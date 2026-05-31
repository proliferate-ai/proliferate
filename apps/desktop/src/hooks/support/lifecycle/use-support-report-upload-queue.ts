import {
  resolveWorkspaceConnectionFromContext,
  useAnyHarnessWorkspaceContext,
  type AnyHarnessResolvedConnection,
} from "@anyharness/sdk-react";
import { useEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import {
  completeSupportReportUpload,
  createSupportReportUpload,
} from "@proliferate/cloud-sdk/client/support";
import type {
  SupportReportCompleteRequest,
  SupportReportUploadRequest,
  SupportReportUploadResponse,
} from "@proliferate/cloud-sdk/types";
import {
  collectSupportDiagnostics,
  logRendererEvent,
} from "@/lib/access/tauri/diagnostics";
import {
  deleteStagedSupportReportAttachment,
  listenSupportReportJobs,
  readStagedSupportReportAttachment,
} from "@/lib/access/tauri/support";
import { createSessionDebugClient } from "@/lib/access/anyharness/debug-client";
import type { SupportReportJob } from "@/lib/domain/support/report-types";
import {
  describeSupportReportUploadFailure,
  shouldShowSupportReportUploadFailureToast,
  type SupportReportUploadFailure,
  type SupportReportUploadFailureKind,
} from "@/lib/domain/support/report-upload-failure";
import {
  buildSupportReportPackage,
  type SupportReportUploadDependencies,
} from "@/lib/workflows/support/support-report-upload-workflows";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useToastStore } from "@/stores/toast/toast-store";

const STORAGE_KEY = "proliferate.supportReportJobs.v1";
const DIAGNOSTICS_MAX_BYTES = 25 * 1024 * 1024;
const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
const TOTAL_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;

interface PersistedSupportReportJob {
  job: SupportReportJob;
  attemptCount: number;
  nextAttemptAt?: string | null;
  lastError?: string | null;
  lastFailureKind?: SupportReportUploadFailureKind | null;
  lastFailureToastAt?: string | null;
  lastFailureToastKind?: SupportReportUploadFailureKind | null;
}

export function useSupportReportUploadQueue(): void {
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
    collectDiagnostics: collectSupportDiagnostics,
    resolveWorkspace: (workspaceId) => resolveWorkspaceConnectionFromContext(
      {
        workspaceId: contextWorkspaceId,
        resolveConnection,
      },
      workspaceId,
    ),
    getClient: createSessionDebugClient,
  }), [contextWorkspaceId, resolveConnection, runtimeUrl]);

  useEffect(() => {
    let disposed = false;

    const processQueue = () => {
      if (disposed || processingRef.current) {
        return;
      }
      processingRef.current = true;
      void drainSupportReportQueue(dependencies, showToast)
        .finally(() => {
          processingRef.current = false;
          if (!disposed) {
            scheduleNextRetry(processQueue, retryTimerRef);
          }
        });
    };

    void listenSupportReportJobs((job) => {
      persistSupportReportJob(job);
      showToast("Sending report...", "info");
      processQueue();
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      processQueue();
    });

    return () => {
      disposed = true;
      if (retryTimerRef.current != null) {
        window.clearTimeout(retryTimerRef.current);
      }
    };
  }, [dependencies, showToast]);
}

async function drainSupportReportQueue(
  dependencies: SupportReportUploadDependencies<AnyHarnessResolvedConnection>,
  showToast: (message: string, type?: "error" | "info") => void,
): Promise<void> {
  const queued = readPersistedJobs();
  const now = Date.now();
  for (const entry of queued) {
    const nextAttemptMs = entry.nextAttemptAt ? Date.parse(entry.nextAttemptAt) : 0;
    if (Number.isFinite(nextAttemptMs) && nextAttemptMs > now) {
      continue;
    }

    try {
      await uploadSupportReport(entry.job, dependencies);
      removePersistedJob(entry.job.jobId);
      showToast("Thanks. Report sent.", "info");
    } catch (error) {
      const attemptCount = entry.attemptCount + 1;
      const failure = describeSupportReportUploadFailure(error, attemptCount);
      void logRendererEvent({
        source: "support_report_upload",
        message: `failed.${failure.kind}`,
      });
      if (!failure.retryable) {
        removePersistedJob(entry.job.jobId);
        await deleteSupportReportJobAttachments(entry.job);
        showToast(failure.toastMessage);
        continue;
      }

      const nowMs = Date.now();
      const shouldToast = shouldShowSupportReportUploadFailureToast({
        failure,
        lastToastAt: entry.lastFailureToastAt,
        lastToastKind: entry.lastFailureToastKind,
        nowMs,
      });
      markPersistedJobFailed(entry.job.jobId, failure, new Date(nowMs), shouldToast);
      if (shouldToast) {
        showToast(failure.toastMessage);
      }
    }
  }
}

async function uploadSupportReport(
  job: SupportReportJob,
  dependencies: SupportReportUploadDependencies<AnyHarnessResolvedConnection>,
): Promise<void> {
  validateAttachmentSizes(job);
  const reportPackage = await buildSupportReportPackage(job, dependencies);
  const diagnosticsBlob = jsonBlob(reportPackage);
  if (diagnosticsBlob.size > DIAGNOSTICS_MAX_BYTES) {
    throw new Error("Diagnostics are too large to upload.");
  }
  const diagnosticsSha256 = await sha256Hex(await diagnosticsBlob.arrayBuffer());
  const attachmentBlobs = await Promise.all(job.attachments.map(async (attachment) => ({
    attachment,
    blob: await loadAttachmentBlob(attachment),
  })));
  const attachmentHashes = await Promise.all(attachmentBlobs.map(async ({ blob }) =>
    sha256Hex(await blob.arrayBuffer())
  ));

  const uploadRequest: SupportReportUploadRequest = {
    message: job.message,
    context: job.snapshot.context,
    scope: job.scope,
    diagnostics: {
      contentType: "application/json",
      sizeBytes: diagnosticsBlob.size,
      sha256: diagnosticsSha256,
    },
    attachments: attachmentBlobs.map(({ attachment, blob }, index) => ({
      clientFileId: attachment.clientFileId,
      fileName: attachment.fileName,
      contentType: attachment.contentType || "application/octet-stream",
      sizeBytes: blob.size,
      sha256: attachmentHashes[index] ?? "",
    })),
  };

  const upload = await createSupportReportUpload(uploadRequest);
  if (!upload.diagnostics) {
    throw new Error("Cloud did not return a diagnostics upload URL.");
  }
  await putPresignedObject(upload.diagnostics, diagnosticsBlob);

  const completedAttachments = [];
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

  const completeRequest: SupportReportCompleteRequest = {
    diagnostics: {
      objectKey: upload.diagnostics.objectKey,
      sha256: diagnosticsSha256,
      sizeBytes: diagnosticsBlob.size,
    },
    attachments: completedAttachments,
    packageManifest: {
      schemaVersion: 1,
      jobId: job.jobId,
      generatedAt: reportPackage.generatedAt,
      diagnosticsBytes: diagnosticsBlob.size,
      attachmentCount: completedAttachments.length,
    },
  };
  await completeSupportReportUpload(upload.reportId, completeRequest);
  await deleteSupportReportJobAttachments(job);
}

async function putPresignedObject(
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

function validateAttachmentSizes(job: SupportReportJob): void {
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

function jsonBlob(value: unknown): Blob {
  return new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
}

function base64Blob(dataBase64: string, contentType: string): Blob {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: contentType || "application/octet-stream" });
}

async function loadAttachmentBlob(
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

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function persistSupportReportJob(job: SupportReportJob): void {
  const current = readPersistedJobs();
  if (current.some((entry) => entry.job.jobId === job.jobId)) {
    return;
  }
  writePersistedJobs([
    ...current,
    {
      job,
      attemptCount: 0,
      nextAttemptAt: null,
      lastError: null,
    },
  ]);
}

function removePersistedJob(jobId: string): void {
  writePersistedJobs(readPersistedJobs().filter((entry) => entry.job.jobId !== jobId));
}

function markPersistedJobFailed(
  jobId: string,
  failure: SupportReportUploadFailure,
  failedAt: Date,
  markedToastShown: boolean,
): void {
  writePersistedJobs(readPersistedJobs().map((entry) => {
    if (entry.job.jobId !== jobId) {
      return entry;
    }
    const attemptCount = Math.max(entry.attemptCount + 1, 1);
    return {
      ...entry,
      attemptCount,
      lastError: failure.message,
      lastFailureKind: failure.kind,
      lastFailureToastAt: markedToastShown
        ? failedAt.toISOString()
        : entry.lastFailureToastAt ?? null,
      lastFailureToastKind: markedToastShown
        ? failure.kind
        : entry.lastFailureToastKind ?? null,
      nextAttemptAt: failure.retryDelayMs == null
        ? null
        : new Date(failedAt.getTime() + failure.retryDelayMs).toISOString(),
    };
  }));
}

function scheduleNextRetry(
  processQueue: () => void,
  retryTimerRef: MutableRefObject<number | null>,
): void {
  if (retryTimerRef.current != null) {
    window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }
  const next = readPersistedJobs()
    .map((entry) => entry.nextAttemptAt ? Date.parse(entry.nextAttemptAt) : Date.now())
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];
  if (next == null) {
    return;
  }
  retryTimerRef.current = window.setTimeout(processQueue, Math.max(1000, next - Date.now()));
}

function readPersistedJobs(): PersistedSupportReportJob[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePersistedJobs(jobs: PersistedSupportReportJob[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs.slice(-10)));
}

async function deleteSupportReportJobAttachments(job: SupportReportJob): Promise<void> {
  await Promise.all(job.attachments.map(async (attachment) => {
    if (attachment.stagedPath) {
      await deleteStagedSupportReportAttachment(attachment.stagedPath).catch(() => {});
    }
  }));
}
