import type {
  PersistedSupportArtifactRefV1,
} from "@proliferate/product-client/host/desktop-bridge";
import type {
  SupportReportJob,
} from "#product/lib/domain/support/report-types";

import { canonicalQueueJson } from "./support-report-queue-canonical";
import {
  exactRecord,
  invalid,
  nullableBoundedString,
  nullableFailureKind,
  nullableTimestamp,
  record,
  safeInteger,
} from "./support-report-job-scalars";
import { parseSupportReportJob } from "./support-report-job-parse";

export interface PersistedSupportReportJob {
  job: SupportReportJob;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  lastFailureKind: string | null;
  lastFailureToastAt: string | null;
  lastFailureToastKind: string | null;
}

export function normalizeSupportReportJobForEnqueue(
  value: unknown,
  forceNoSnapshot = false,
): SupportReportJob {
  let decoded: unknown;
  try {
    decoded = JSON.parse(canonicalQueueJson(value)) as unknown;
  } catch {
    throw new Error("Support report job is not canonical JSON.");
  }
  const job = record(decoded, "job");
  delete job.includeLogs;
  if (forceNoSnapshot || !Object.prototype.hasOwnProperty.call(job, "supportSnapshot")) {
    job.supportSnapshot = { kind: "none" };
  }
  return parseSupportReportJob(job);
}

export function createPersistedSupportReportJob(
  job: SupportReportJob,
): PersistedSupportReportJob {
  return {
    job,
    attemptCount: 0,
    nextAttemptAt: null,
    lastError: null,
    lastFailureKind: null,
    lastFailureToastAt: null,
    lastFailureToastKind: null,
  };
}

export function parsePersistedSupportReportJob(value: unknown): PersistedSupportReportJob {
  const entry = exactRecord(value, [
    "attemptCount",
    "job",
    "lastError",
    "lastFailureKind",
    "lastFailureToastAt",
    "lastFailureToastKind",
    "nextAttemptAt",
  ]);
  safeInteger(entry.attemptCount, "attemptCount", Number.MAX_SAFE_INTEGER - 1);
  nullableTimestamp(entry.nextAttemptAt, "nextAttemptAt");
  nullableBoundedString(entry.lastError, 4_096, "lastError");
  nullableFailureKind(entry.lastFailureKind, "lastFailureKind");
  nullableTimestamp(entry.lastFailureToastAt, "lastFailureToastAt");
  nullableFailureKind(entry.lastFailureToastKind, "lastFailureToastKind");
  parseSupportReportJob(entry.job);
  return entry as unknown as PersistedSupportReportJob;
}

export function parsePackagedPersistedSupportReportJob(
  value: unknown,
): PersistedSupportReportJob {
  const entry = parsePersistedSupportReportJob(value);
  assertPackagedSupportReportJob(entry.job);
  return entry;
}

export function assertPackagedSupportReportJob(job: SupportReportJob): void {
  for (const attachment of job.attachments) {
    if (!attachment.stagedPath || attachment.dataBase64 !== undefined) {
      invalid("packaged attachment reference");
    }
  }
}

export function canonicalSupportReportJobBytes(job: SupportReportJob): string {
  return canonicalQueueJson(job);
}

export function supportArtifactTuple(job: SupportReportJob): string | null {
  if (job.supportSnapshot.kind === "none") return null;
  const artifact = job.supportSnapshot.artifact;
  return canonicalQueueJson({
    artifactId: artifact.artifactId,
    sha256: artifact.sha256,
    sizeBytes: artifact.sizeBytes,
    snapshotId: artifact.snapshotId,
  });
}

export function persistedArtifactReference(
  job: SupportReportJob,
): PersistedSupportArtifactRefV1 | null {
  if (job.supportSnapshot.kind === "none") return null;
  const artifact = job.supportSnapshot.artifact;
  return {
    clientJobId: job.jobId,
    artifactId: artifact.artifactId,
    snapshotId: artifact.snapshotId,
    sizeBytes: artifact.sizeBytes,
    sha256: artifact.sha256,
  };
}

export function stagedAttachmentPaths(job: SupportReportJob): string[] {
  return job.attachments.flatMap((attachment) =>
    attachment.stagedPath ? [attachment.stagedPath] : []
  );
}
