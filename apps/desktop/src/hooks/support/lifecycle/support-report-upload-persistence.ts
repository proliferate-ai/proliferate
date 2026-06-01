import type { MutableRefObject } from "react";
import {
  deleteStagedSupportReportAttachment,
} from "@/lib/access/tauri/support";
import type {
  SupportReportJob,
} from "@/lib/domain/support/report-types";
import type {
  SupportReportUploadFailure,
  SupportReportUploadFailureKind,
} from "@/lib/domain/support/report-upload-failure";

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

export function persistSupportReportJob(job: SupportReportJob): boolean {
  const current = readPersistedJobs();
  if (current.some((entry) => entry.job.jobId === job.jobId)) {
    return false;
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
  return true;
}

export function removePersistedJob(jobId: string): void {
  writePersistedJobs(readPersistedJobs().filter((entry) => entry.job.jobId !== jobId));
}

export function markPersistedJobFailed(
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

export function scheduleNextRetry(
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

export function readPersistedJobs(): PersistedSupportReportJob[] {
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

export async function deleteSupportReportJobAttachments(job: SupportReportJob): Promise<void> {
  await Promise.all(job.attachments.map(async (attachment) => {
    if (attachment.stagedPath) {
      await deleteStagedSupportReportAttachment(attachment.stagedPath).catch(() => {});
    }
  }));
}

function writePersistedJobs(jobs: PersistedSupportReportJob[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs.slice(-10)));
}
