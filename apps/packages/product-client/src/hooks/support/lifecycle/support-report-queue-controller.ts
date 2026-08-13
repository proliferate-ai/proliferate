import type {
  DesktopSupportSnapshotBridge,
  PersistedSupportArtifactRefV1,
  ReconciledSupportArtifactV1,
} from "@proliferate/product-client/host/desktop-bridge";
import type { ProductStorage } from "#product/host/product-host";
import type { SupportReportJob } from "#product/lib/domain/support/report-types";
import type { SupportReportUploadFailure } from "#product/lib/domain/support/report-upload-failure";
import type { SupportReportEnqueueResult } from "#product/lib/access/browser/support-report-job-events";

import {
  sha256QueueText,
} from "./support-report-queue-canonical";
import {
  assertPackagedSupportReportJob,
  canonicalSupportReportJobBytes,
  createPersistedSupportReportJob,
  normalizeSupportReportJobForEnqueue,
  parsePackagedPersistedSupportReportJob,
  persistedArtifactReference,
  stagedAttachmentPaths,
  supportArtifactTuple,
  type PersistedSupportReportJob,
} from "./support-report-queue-entry";
import {
  createNextSupportQueueDocument,
  SUPPORT_QUEUE_MAX_JOBS,
  SupportQueueDocumentError,
  type SupportQueueDocumentV2,
} from "./support-report-queue-document";
import { hydrateOrMigrateSupportQueue } from "./support-report-queue-migration";
import { commitSupportQueueMutation } from "./support-report-queue-storage";
import {
  notifySupportReportQueueObserver,
  type SupportReportQueueCallbacks,
  type SupportReportQueueRuntime,
} from "./support-report-queue-runtime";

interface PackagedQueueControllerInput {
  storage: ProductStorage;
  supportSnapshot: DesktopSupportSnapshotBridge;
  deleteAttachment(path: string): Promise<void>;
  callbacks: SupportReportQueueCallbacks;
}

/** The sole in-process writer for the packaged-native V2 support queue. */
export class PackagedSupportReportQueueController implements SupportReportQueueRuntime {
  private readonly input: PackagedQueueControllerInput;
  private document: SupportQueueDocumentV2<PersistedSupportReportJob> | null = null;
  private mutationTail: Promise<void> = Promise.resolve();
  private initialized = false;
  private blocked = false;
  private disposed = false;

  constructor(input: PackagedQueueControllerInput) {
    this.input = input;
  }

  initialize(): Promise<void> {
    return this.serialize(async () => {
      if (this.initialized) return;
      if (this.blocked) throw new Error("Support queue readiness is blocked.");
      this.ensureActive();
      try {
        this.document = await hydrateOrMigrateSupportQueue(
          this.input.storage,
          parsePackagedPersistedSupportReportJob,
        );
        validateUniqueJobs(this.document.jobs);
        await validateArtifactBindings(this.document.jobs.map(({ job }) => job));
        this.ensureActive();
        await this.reconcileOnce();
        this.ensureActive();
        this.initialized = true;
      } catch (error) {
        this.blocked = true;
        throw error;
      }
    });
  }

  enqueue(job: SupportReportJob): Promise<SupportReportEnqueueResult> {
    // Snapshot immutable request bytes before this call yields. The event
    // sender cannot mutate a queued request while an earlier mutation drains.
    let normalized: SupportReportJob;
    try {
      normalized = normalizeSupportReportJobForEnqueue(job);
      assertPackagedSupportReportJob(normalized);
    } catch (error) {
      this.notifyControllerError(error);
      return Promise.resolve("failed");
    }
    return this.serialize(async () => {
      if (!this.ready()) return "failed";
      try {
        await validateArtifactBindings([normalized]);
      } catch (error) {
        this.notifyControllerError(error);
        return "failed";
      }
      const current = this.current();
      const existing = current.jobs.find((entry) => entry.job.jobId === normalized.jobId);
      if (existing) {
        const duplicate = canonicalSupportReportJobBytes(existing.job)
          === canonicalSupportReportJobBytes(normalized)
          && supportArtifactTuple(existing.job) === supportArtifactTuple(normalized);
        if (duplicate) return this.disposed ? "failed" : "duplicate";
        await this.cleanupRejectedJob(normalized, true);
        return "conflict";
      }
      if (current.jobs.length >= SUPPORT_QUEUE_MAX_JOBS) {
        await this.cleanupRejectedJob(normalized, true);
        return "full";
      }

      const jobs = [...current.jobs, createPersistedSupportReportJob(normalized)];
      try {
        await createNextSupportQueueDocument(current, jobs);
      } catch (error) {
        if (error instanceof SupportQueueDocumentError
          && (error.failure === "bytes_exceeded" || error.failure === "jobs_exceeded")) {
          await this.cleanupRejectedJob(normalized, true);
          return "full";
        }
        this.blocked = true;
        this.notifyControllerError(error);
        return "failed";
      }

      try {
        this.document = await commitSupportQueueMutation(
          this.input.storage,
          current,
          jobs,
          parsePackagedPersistedSupportReportJob,
        );
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
      return this.current().jobs.filter((entry) => {
        if (!entry.nextAttemptAt) return true;
        const next = Date.parse(entry.nextAttemptAt);
        return !Number.isFinite(next) || next <= nowMs;
      });
    });
  }

  nextAttemptAtMs(): Promise<number | null> {
    return this.serialize(async () => {
      if (!this.ready()) return null;
      const times = this.current().jobs.flatMap((entry) => {
        if (!entry.nextAttemptAt) return [Date.now()];
        const next = Date.parse(entry.nextAttemptAt);
        return Number.isFinite(next) ? [next] : [Date.now()];
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
      const current = this.current();
      let changed = false;
      const jobs = current.jobs.map((entry) => {
        if (entry.job.jobId !== jobId) return entry;
        changed = true;
        const attemptCount = Math.min(
          Math.max(entry.attemptCount + 1, 1),
          Number.MAX_SAFE_INTEGER - 1,
        );
        return {
          ...entry,
          attemptCount,
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
      if (changed) await this.commit(current, jobs);
    });
  }

  removeAndCleanup(jobId: string): Promise<SupportReportJob | null> {
    return this.serialize(async () => {
      this.requireReady();
      const current = this.current();
      const removed = current.jobs.find((entry) => entry.job.jobId === jobId);
      if (!removed) return null;
      const jobs = current.jobs.filter((entry) => entry.job.jobId !== jobId);
      await this.commit(current, jobs);
      await this.cleanupCommittedRemoval(removed.job);
      this.requireReady();
      return removed.job;
    });
  }

  dispose(): void {
    this.disposed = true;
  }

  private async reconcileOnce(): Promise<void> {
    const current = this.current();
    const artifacts = current.jobs.flatMap(({ job }) => {
      const reference = persistedArtifactReference(job);
      return reference ? [reference] : [];
    });
    const referencedAttachmentPaths = uniqueStrings(
      current.jobs.flatMap(({ job }) => stagedAttachmentPaths(job)),
    );
    const reconciled = await this.input.supportSnapshot.reconcileArtifacts({
      artifacts,
      referencedAttachmentPaths,
    });
    this.ensureActive();
    const states = validateReconciliation(artifacts, reconciled);
    const unavailable = current.jobs.filter(({ job }) => {
      const reference = persistedArtifactReference(job);
      return reference ? states.get(referenceKey(reference)) !== "verified" : false;
    });
    if (unavailable.length === 0) return;

    const unavailableIds = new Set(unavailable.map(({ job }) => job.jobId));
    const retained = current.jobs.filter(({ job }) => !unavailableIds.has(job.jobId));
    await this.commit(current, retained);
    for (const entry of unavailable) {
      const reference = persistedArtifactReference(entry.job);
      const state = reference ? states.get(referenceKey(reference)) : undefined;
      if (state === "missing" || state === "mismatch") {
        notifySupportReportQueueObserver(() => {
          this.input.callbacks.onSnapshotUnavailable(entry.job.jobId, state);
        });
      }
      await this.cleanupCommittedRemoval(entry.job);
    }
  }

  private async commit(
    current: SupportQueueDocumentV2<PersistedSupportReportJob>,
    jobs: readonly PersistedSupportReportJob[],
  ): Promise<void> {
    try {
      this.document = await commitSupportQueueMutation(
        this.input.storage,
        current,
        jobs,
        parsePackagedPersistedSupportReportJob,
      );
    } catch (error) {
      this.blocked = true;
      throw error;
    }
  }

  private async cleanupRejectedJob(job: SupportReportJob, includeSnapshot: boolean): Promise<void> {
    const referencedPaths = new Set(
      this.current().jobs.flatMap(({ job: queued }) => stagedAttachmentPaths(queued)),
    );
    for (const path of stagedAttachmentPaths(job)) {
      if (!referencedPaths.has(path)) await this.deleteAttachment(path);
    }
    if (!includeSnapshot || job.supportSnapshot.kind !== "prepared") return;
    const referencedArtifacts = new Set(this.current().jobs.flatMap(({ job: queued }) => {
      const reference = persistedArtifactReference(queued);
      return reference ? [reference.artifactId] : [];
    }));
    if (!referencedArtifacts.has(job.supportSnapshot.artifact.artifactId)) {
      await this.deleteSnapshot(job.supportSnapshot.artifact.artifactId);
    }
  }

  private async cleanupCommittedRemoval(job: SupportReportJob): Promise<void> {
    const retained = this.current().jobs;
    const retainedPaths = new Set(retained.flatMap(({ job }) => stagedAttachmentPaths(job)));
    for (const path of stagedAttachmentPaths(job)) {
      if (!retainedPaths.has(path)) await this.deleteAttachment(path);
    }
    if (job.supportSnapshot.kind !== "prepared") return;
    const retainedArtifacts = new Set(retained.flatMap(({ job }) => {
      const reference = persistedArtifactReference(job);
      return reference ? [reference.artifactId] : [];
    }));
    const artifactId = job.supportSnapshot.artifact.artifactId;
    if (!retainedArtifacts.has(artifactId)) await this.deleteSnapshot(artifactId);
  }

  private async deleteAttachment(path: string): Promise<void> {
    try {
      await this.input.deleteAttachment(path);
    } catch (error) {
      this.notifyCleanupError(error, "attachment");
    }
  }

  private async deleteSnapshot(artifactId: string): Promise<void> {
    try {
      await this.input.supportSnapshot.deleteArtifact(artifactId);
    } catch (error) {
      this.notifyCleanupError(error, "snapshot");
    }
  }

  private notifyControllerError(error: unknown): void {
    notifySupportReportQueueObserver(() => {
      this.input.callbacks.onControllerError(error);
    });
  }

  private notifyCleanupError(error: unknown, resource: "attachment" | "snapshot"): void {
    notifySupportReportQueueObserver(() => {
      this.input.callbacks.onCleanupError(error, resource);
    });
  }

  private current(): SupportQueueDocumentV2<PersistedSupportReportJob> {
    if (!this.document) throw new Error("Support queue is not hydrated.");
    return this.document;
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

function validateUniqueJobs(entries: readonly PersistedSupportReportJob[]): void {
  const jobIds = new Set<string>();
  const artifactIds = new Set<string>();
  for (const { job } of entries) {
    if (jobIds.has(job.jobId)) throw new Error("Support queue contains duplicate job IDs.");
    jobIds.add(job.jobId);
    const reference = persistedArtifactReference(job);
    if (reference) {
      if (artifactIds.has(reference.artifactId)) {
        throw new Error("Support queue contains a shared snapshot artifact.");
      }
      artifactIds.add(reference.artifactId);
    }
  }
}

function validateReconciliation(
  expected: readonly PersistedSupportArtifactRefV1[],
  actual: readonly ReconciledSupportArtifactV1[],
): Map<string, ReconciledSupportArtifactV1["state"]> {
  if (!Array.isArray(actual) || actual.length !== expected.length) {
    throw new Error("Native support artifact reconciliation was incomplete.");
  }
  const expectedKeys = new Set(expected.map(referenceKey));
  const states = new Map<string, ReconciledSupportArtifactV1["state"]>();
  for (const item of actual) {
    if (!isExactReconciledArtifact(item)) {
      throw new Error("Native support artifact reconciliation was invalid.");
    }
    const key = referenceKey(item);
    if (!expectedKeys.has(key) || states.has(key)
      || !["verified", "missing", "mismatch"].includes(item.state)) {
      throw new Error("Native support artifact reconciliation was invalid.");
    }
    states.set(key, item.state);
  }
  return states;
}

function isExactReconciledArtifact(value: unknown): value is ReconciledSupportArtifactV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const item = value as Record<string, unknown>;
  const keys = [
    "artifactId",
    "clientJobId",
    "sha256",
    "sizeBytes",
    "snapshotId",
    "state",
  ];
  return Object.keys(item).length === keys.length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(item, key))
    && typeof item.artifactId === "string"
    && typeof item.clientJobId === "string"
    && typeof item.snapshotId === "string"
    && typeof item.sha256 === "string"
    && Number.isSafeInteger(item.sizeBytes)
    && ["verified", "missing", "mismatch"].includes(item.state as string);
}

function referenceKey(reference: PersistedSupportArtifactRefV1): string {
  return [
    reference.clientJobId,
    reference.artifactId,
    reference.snapshotId,
    reference.sizeBytes,
    reference.sha256,
  ].join("\u0000");
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function boundedFailureMessage(message: string): string {
  return new TextEncoder().encode(message).byteLength <= 4_096
    ? message
    : "Report upload failed.";
}

async function validateArtifactBindings(jobs: readonly SupportReportJob[]): Promise<void> {
  for (const job of jobs) {
    if (job.supportSnapshot.kind !== "prepared") continue;
    const expected = `ssv1_${await sha256QueueText(
      `proliferate-support-snapshot-v1\u0000${job.jobId}`,
    )}`;
    if (job.supportSnapshot.artifact.artifactId !== expected) {
      throw new Error("Support snapshot artifact is not bound to its report job.");
    }
  }
}
