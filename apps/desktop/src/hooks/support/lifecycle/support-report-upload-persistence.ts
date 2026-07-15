import type { MutableRefObject } from "react";
import type {
  SupportReportJob,
} from "@/lib/domain/support/report-types";
import type {
  SupportReportUploadFailure,
  SupportReportUploadFailureKind,
} from "@/lib/domain/support/report-upload-failure";
import {
  readPersistedJson,
  writePersistedJson,
  type ProductStorageContext,
} from "@/lib/infra/persistence/product-storage";

const STORAGE_KEY = "proliferate.supportReportJobs.v1";

export interface PersistedSupportReportJob {
  job: SupportReportJob;
  attemptCount: number;
  nextAttemptAt?: string | null;
  lastError?: string | null;
  lastFailureKind?: SupportReportUploadFailureKind | null;
  lastFailureToastAt?: string | null;
  lastFailureToastKind?: SupportReportUploadFailureKind | null;
}

export async function persistSupportReportJob(
  storage: ProductStorageContext,
  job: SupportReportJob,
): Promise<boolean> {
  const current = await readPersistedJobs(storage);
  if (current.some((entry) => entry.job.jobId === job.jobId)) {
    return false;
  }
  await writePersistedJobs(storage, [
    ...current,
    {
      job,
      attemptCount: 0,
      nextAttemptAt: null,
      lastError: null,
    },
  ]);
  return true;
}

export async function removePersistedJob(
  storage: ProductStorageContext,
  jobId: string,
): Promise<void> {
  await writePersistedJobs(
    storage,
    (await readPersistedJobs(storage)).filter((entry) => entry.job.jobId !== jobId),
  );
}

export async function markPersistedJobFailed(
  storage: ProductStorageContext,
  jobId: string,
  failure: SupportReportUploadFailure,
  failedAt: Date,
  markedToastShown: boolean,
): Promise<void> {
  await writePersistedJobs(storage, (await readPersistedJobs(storage)).map((entry) => {
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

export async function scheduleNextRetry(
  storage: ProductStorageContext,
  processQueue: () => void,
  retryTimerRef: MutableRefObject<number | null>,
): Promise<void> {
  if (retryTimerRef.current != null) {
    window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }
  const next = (await readPersistedJobs(storage))
    .map((entry) => entry.nextAttemptAt ? Date.parse(entry.nextAttemptAt) : Date.now())
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];
  if (next == null) {
    return;
  }
  retryTimerRef.current = window.setTimeout(processQueue, Math.max(1000, next - Date.now()));
}

export async function readPersistedJobs(
  storage: ProductStorageContext,
): Promise<PersistedSupportReportJob[]> {
  const result = await readPersistedJson<PersistedSupportReportJob[]>(storage, STORAGE_KEY, {
    parse: (raw) => (Array.isArray(raw) ? (raw as PersistedSupportReportJob[]) : []),
    fallback: [],
  });
  return result.status === "settled" ? result.value : [];
}

export async function deleteSupportReportJobAttachments(
  job: SupportReportJob,
  deleteAttachment?: (path: string) => Promise<void>,
): Promise<void> {
  await Promise.all(job.attachments.map(async (attachment) => {
    if (attachment.stagedPath && deleteAttachment) {
      await deleteAttachment(attachment.stagedPath).catch(() => {});
    }
  }));
}

async function writePersistedJobs(
  storage: ProductStorageContext,
  jobs: PersistedSupportReportJob[],
): Promise<void> {
  await writePersistedJson(storage, STORAGE_KEY, jobs.slice(-10));
}
