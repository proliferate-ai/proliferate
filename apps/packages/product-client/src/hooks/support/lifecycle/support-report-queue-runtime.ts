import type { SupportReportJob } from "#product/lib/domain/support/report-types";
import type { SupportReportUploadFailure } from "#product/lib/domain/support/report-upload-failure";
import type { SupportReportEnqueueResult } from "#product/lib/access/browser/support-report-job-events";

import type { PersistedSupportReportJob } from "./support-report-queue-entry";

export interface SupportReportQueueRuntime {
  initialize(): Promise<void>;
  enqueue(job: SupportReportJob): Promise<SupportReportEnqueueResult>;
  dueEntries(nowMs: number): Promise<PersistedSupportReportJob[]>;
  nextAttemptAtMs(): Promise<number | null>;
  markFailed(
    jobId: string,
    failure: SupportReportUploadFailure,
    failedAt: Date,
    markedToastShown: boolean,
  ): Promise<void>;
  removeAndCleanup(jobId: string): Promise<SupportReportJob | null>;
  dispose(): void;
}

export interface SupportReportQueueCallbacks {
  onControllerError(error: unknown): void;
  onCleanupError(error: unknown, resource: "attachment" | "snapshot"): void;
  onSnapshotUnavailable(jobId: string, state: "missing" | "mismatch"): void;
}
