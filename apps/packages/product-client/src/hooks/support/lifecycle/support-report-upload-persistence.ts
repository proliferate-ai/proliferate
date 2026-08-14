import type { ProductStorage } from "#product/host/product-host";
import type { SupportReportJob } from "#product/lib/domain/support/report-types";
import type { SupportReportUploadFailure } from "#product/lib/domain/support/report-upload-failure";
import type { SupportReportEnqueueResult } from "#product/lib/access/browser/support-report-job-events";

import {
  canonicalSupportReportJobBytes,
  createPersistedSupportReportJob,
  normalizeSupportReportJobForEnqueue,
  parsePersistedSupportReportJob,
  stagedAttachmentPaths,
  type PersistedSupportReportJob,
} from "./support-report-queue-entry";
import { SUPPORT_QUEUE_LEGACY_KEY } from "./support-report-queue-migration";
import {
  notifySupportReportQueueObserver,
  type SupportReportQueueCallbacks,
  type SupportReportQueueRuntime,
} from "./support-report-queue-runtime";

const MAX_JOBS = 10;

interface BrowserQueueControllerInput {
  storage: ProductStorage;
  deleteAttachment(path: string): Promise<void>;
  callbacks: SupportReportQueueCallbacks;
}

/**
 * Browser/Web fallback owner. It deliberately retains V1 JSON persistence so
 * allowed inline attachment bytes never enter the V2 two-MiB document. It
 * still serializes every mutation and rejects capacity instead of evicting.
 */
export class BrowserSupportReportQueueController implements SupportReportQueueRuntime {
  private readonly input: BrowserQueueControllerInput;
  private jobs: PersistedSupportReportJob[] | null = null;
  private mutationTail: Promise<void> = Promise.resolve();
  private initialized = false;
  private blocked = false;
  private disposed = false;

  constructor(input: BrowserQueueControllerInput) {
    this.input = input;
  }

  initialize(): Promise<void> {
    return this.serialize(async () => {
      if (this.initialized) return;
      if (this.blocked) throw new Error("Support queue readiness is blocked.");
      this.ensureActive();
      try {
        const raw = await this.input.storage.getItem(SUPPORT_QUEUE_LEGACY_KEY);
        this.jobs = raw === null ? [] : parseLegacyQueue(raw);
        this.initialized = true;
      } catch (error) {
        this.blocked = true;
        throw error;
      }
    });
  }

  enqueue(job: SupportReportJob): Promise<SupportReportEnqueueResult> {
    // Snapshot immutable request bytes synchronously so a caller cannot alter
    // the job while an earlier serialized mutation is still committing.
    let normalized: SupportReportJob;
    try {
      normalized = normalizeSupportReportJobForEnqueue(job, true);
    } catch (error) {
      this.notifyControllerError(error);
      return Promise.resolve("failed");
    }
    return this.serialize(async () => {
      if (!this.ready()) return "failed";
      const existing = this.current().find((entry) => entry.job.jobId === normalized.jobId);
      if (existing) {
        if (canonicalSupportReportJobBytes(existing.job)
          === canonicalSupportReportJobBytes(normalized)) {
          return this.disposed ? "failed" : "duplicate";
        }
        await this.cleanupUnreferencedAttachments(normalized);
        return "conflict";
      }
      if (this.current().length >= MAX_JOBS) {
        await this.cleanupUnreferencedAttachments(normalized);
        return "full";
      }
      const jobs = [...this.current(), createPersistedSupportReportJob(normalized)];
      try {
        await this.write(jobs);
      } catch (error) {
        this.blocked = true;
        this.notifyControllerError(error);
        return "failed";
      }
      return this.disposed ? "failed" : "queued";
    });
  }

  dueEntries(nowMs: number): Promise<PersistedSupportReportJob[]> {
    return this.serialize(async () => {
      if (!this.ready()) return [];
      return this.current().filter((entry) => {
        const next = entry.nextAttemptAt ? Date.parse(entry.nextAttemptAt) : 0;
        return !Number.isFinite(next) || next <= nowMs;
      });
    });
  }

  nextAttemptAtMs(): Promise<number | null> {
    return this.serialize(async () => {
      if (!this.ready()) return null;
      const times = this.current().map((entry) => {
        const next = entry.nextAttemptAt ? Date.parse(entry.nextAttemptAt) : Date.now();
        return Number.isFinite(next) ? next : Date.now();
      });
      return times.length > 0 ? Math.min(...times) : null;
    });
  }

  markFailed(
    jobId: string,
    failure: SupportReportUploadFailure,
    failedAt: Date,
    markedToastShown: boolean,
  ): Promise<void> {
    return this.serialize(async () => {
      this.requireReady();
      let changed = false;
      const jobs = this.current().map((entry) => {
        if (entry.job.jobId !== jobId) return entry;
        changed = true;
        return {
          ...entry,
          attemptCount: Math.min(
            Math.max(entry.attemptCount + 1, 1),
            Number.MAX_SAFE_INTEGER - 1,
          ),
          lastError: boundedFailureMessage(failure.message),
          lastFailureKind: failure.kind,
          lastFailureToastAt: markedToastShown
            ? failedAt.toISOString()
            : entry.lastFailureToastAt,
          lastFailureToastKind: markedToastShown
            ? failure.kind
            : entry.lastFailureToastKind,
          nextAttemptAt: failure.retryDelayMs == null
            ? null
            : new Date(failedAt.getTime() + failure.retryDelayMs).toISOString(),
        } satisfies PersistedSupportReportJob;
      });
      if (changed) await this.write(jobs);
    });
  }

  removeAndCleanup(jobId: string): Promise<SupportReportJob | null> {
    return this.serialize(async () => {
      this.requireReady();
      const removed = this.current().find((entry) => entry.job.jobId === jobId);
      if (!removed) return null;
      await this.write(this.current().filter((entry) => entry.job.jobId !== jobId));
      await this.cleanupUnreferencedAttachments(removed.job);
      this.requireReady();
      return removed.job;
    });
  }

  dispose(): void {
    this.disposed = true;
  }

  private async write(jobs: PersistedSupportReportJob[]): Promise<void> {
    try {
      await this.input.storage.setItem(SUPPORT_QUEUE_LEGACY_KEY, JSON.stringify(
        jobs.map(serializeBrowserEntry),
      ));
      this.jobs = jobs;
    } catch (error) {
      this.blocked = true;
      throw error;
    }
  }

  private async cleanupUnreferencedAttachments(job: SupportReportJob): Promise<void> {
    const retained = new Set(this.current().flatMap(({ job }) => stagedAttachmentPaths(job)));
    for (const path of stagedAttachmentPaths(job)) {
      if (retained.has(path)) continue;
      try {
        await this.input.deleteAttachment(path);
      } catch (error) {
        notifySupportReportQueueObserver(() => {
          this.input.callbacks.onCleanupError(error, "attachment");
        });
      }
    }
  }

  private notifyControllerError(error: unknown): void {
    notifySupportReportQueueObserver(() => {
      this.input.callbacks.onControllerError(error);
    });
  }

  private current(): PersistedSupportReportJob[] {
    if (!this.jobs) throw new Error("Support queue is not hydrated.");
    return this.jobs;
  }

  private ready(): boolean {
    return this.initialized && !this.blocked && !this.disposed;
  }

  private requireReady(): void {
    if (!this.ready()) throw new Error("Support queue is not ready.");
  }

  private ensureActive(): void {
    if (this.disposed) throw new Error("Support queue owner was replaced.");
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation);
    this.mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }
}

function parseLegacyQueue(raw: string): PersistedSupportReportJob[] {
  const decoded = JSON.parse(raw) as unknown;
  if (!Array.isArray(decoded) || decoded.length > MAX_JOBS) {
    throw new Error("Legacy support queue is invalid.");
  }
  const ids = new Set<string>();
  return decoded.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Legacy support queue entry is invalid.");
    }
    const wrapper = value as Record<string, unknown>;
    const allowedKeys = new Set([
      "attemptCount",
      "job",
      "lastError",
      "lastFailureKind",
      "lastFailureToastAt",
      "lastFailureToastKind",
      "nextAttemptAt",
    ]);
    if (!Object.keys(wrapper).every((key) => allowedKeys.has(key))) {
      throw new Error("Legacy support queue entry is invalid.");
    }
    if (!wrapper.job || typeof wrapper.job !== "object" || Array.isArray(wrapper.job)) {
      throw new Error("Legacy support queue job is invalid.");
    }
    if (!Object.prototype.hasOwnProperty.call(wrapper, "attemptCount")) {
      throw new Error("Legacy support queue entry is invalid.");
    }
    const oldJob = wrapper.job as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(oldJob, "supportSnapshot")
      || (oldJob.includeLogs !== undefined && typeof oldJob.includeLogs !== "boolean")) {
      throw new Error("Legacy support queue job is invalid.");
    }
    const legacyIncludeLogs = oldJob.includeLogs === false ? false : true;
    const normalized = normalizeSupportReportJobForEnqueue({
      ...oldJob,
      supportSnapshot: { kind: "none" },
    }, true);
    if (legacyIncludeLogs) normalized.includeLogs = true;
    const entry = parsePersistedSupportReportJob({
      job: normalized,
      attemptCount: wrapper.attemptCount,
      nextAttemptAt: wrapper.nextAttemptAt ?? null,
      lastError: wrapper.lastError ?? null,
      lastFailureKind: wrapper.lastFailureKind ?? null,
      lastFailureToastAt: wrapper.lastFailureToastAt ?? null,
      lastFailureToastKind: wrapper.lastFailureToastKind ?? null,
    });
    if (ids.has(entry.job.jobId)) throw new Error("Legacy support queue has duplicate jobs.");
    ids.add(entry.job.jobId);
    return entry;
  });
}

function serializeBrowserEntry(entry: PersistedSupportReportJob): unknown {
  const { supportSnapshot: _supportSnapshot, includeLogs, ...job } = entry.job;
  return {
    ...entry,
    job: {
      ...job,
      // V1 has no snapshot union. Persist false for every current no-snapshot
      // job so a later packaged-native migration cannot mistake it for old
      // diagnostics consent. A pre-PR6 truthy marker remains truthy until that
      // old job drains, solely to detect an already-locked server intent.
      includeLogs: includeLogs === true,
    },
  };
}

function boundedFailureMessage(message: string): string {
  return new TextEncoder().encode(message).byteLength <= 4_096
    ? message
    : "Report upload failed.";
}
