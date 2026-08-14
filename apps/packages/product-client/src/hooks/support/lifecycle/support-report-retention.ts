import type { PersistedSupportArtifactRefV1 } from "@proliferate/product-client/host/desktop-bridge";
import type { ProductStorage } from "#product/host/product-host";

import {
  parsePersistedSupportReportJob,
  persistedArtifactReference,
  stagedAttachmentPaths,
  type PersistedSupportReportJob,
} from "./support-report-queue-entry";
import { SUPPORT_QUEUE_LEGACY_KEY } from "./support-report-queue-migration";
import {
  commitSupportQueueMutation,
  hydrateSupportQueue,
} from "./support-report-queue-storage";

/**
 * How long an unsent support report may sit in local storage.
 *
 * The drain path gives up on a report long before this: retry exhaustion is
 * counted from the same `createdAt`. Thirty days is therefore past any report
 * that is still legitimately in flight, so the sweep only ever reaps state the
 * queue owner would have removed had it been mounted.
 */
export const SUPPORT_REPORT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface SupportReportRetentionBridge {
  reconcileArtifacts(input: {
    artifacts: PersistedSupportArtifactRefV1[];
    referencedAttachmentPaths: string[];
  }): Promise<unknown>;
}

export interface SupportReportRetentionSweep {
  removedJobIds: string[];
  retainedJobIds: string[];
  removedLegacyDocument: boolean;
  reconciled: boolean;
}

/**
 * Reap abandoned support-report state without a Cloud session.
 *
 * The queue owner that prunes staged artifacts and drains the document is
 * mounted only while authenticated, so a user who signs out or never returns
 * leaves the queue document in local storage and its staged bytes on disk
 * indefinitely. This sweep runs unconditionally at startup and closes both:
 * it drops expired entries from the durable document, and it hands the
 * surviving references to the native reconcile, which deletes every staged
 * artifact and attachment nothing points at any more.
 *
 * It is deliberately conservative. A document that cannot be hydrated is left
 * exactly as it is and the reconcile is skipped -- reconciling against an
 * unknown survivor set would delete staged bytes a repairable document still
 * references.
 */
export async function sweepSupportReportRetention(input: {
  storage: ProductStorage;
  supportSnapshot?: SupportReportRetentionBridge | null;
  now: number;
  isStale?: () => boolean;
}): Promise<SupportReportRetentionSweep> {
  const { storage, supportSnapshot = null, now } = input;
  const isStale = input.isStale ?? (() => false);
  const sweep: SupportReportRetentionSweep = {
    removedJobIds: [],
    retainedJobIds: [],
    removedLegacyDocument: false,
    reconciled: false,
  };

  sweep.removedLegacyDocument = await sweepLegacyDocument(storage, now);
  if (isStale()) return sweep;

  const current = await hydrateSupportQueue(storage, parsePersistedSupportReportJob);
  if (isStale()) return sweep;

  const retained: PersistedSupportReportJob[] = [];
  for (const entry of current.jobs) {
    if (isExpired(entry.job.createdAt, now)) {
      sweep.removedJobIds.push(entry.job.jobId);
    } else {
      retained.push(entry);
      sweep.retainedJobIds.push(entry.job.jobId);
    }
  }

  if (sweep.removedJobIds.length > 0) {
    await commitSupportQueueMutation(
      storage,
      current,
      retained,
      parsePersistedSupportReportJob,
    );
    if (isStale()) return sweep;
  }

  // Reconcile even when nothing expired: staged bytes orphaned by an earlier
  // interrupted run are exactly the disk half of the leak, and the survivor
  // set is what proves which of them are still referenced.
  if (supportSnapshot) {
    await supportSnapshot.reconcileArtifacts({
      artifacts: retained.flatMap((entry) => {
        const reference = persistedArtifactReference(entry.job);
        return reference ? [reference] : [];
      }),
      referencedAttachmentPaths: [
        ...new Set(retained.flatMap((entry) => stagedAttachmentPaths(entry.job))),
      ],
    });
    sweep.reconciled = true;
  }

  return sweep;
}

function isExpired(createdAt: string, now: number): boolean {
  const created = Date.parse(createdAt);
  // A `createdAt` the document parser accepted is always a valid timestamp.
  // An unreadable one is not treated as expired: deleting a report on a value
  // this code could not read would be silent data loss.
  if (Number.isNaN(created)) return false;
  return now - created > SUPPORT_REPORT_RETENTION_MS;
}

/**
 * The V1 document belongs to the migration, which only runs behind the same
 * auth gate. The sweep removes it only when every job in it has expired, so a
 * document with a live job is still migrated intact on the next signed-in
 * launch rather than being partially rewritten here.
 */
async function sweepLegacyDocument(
  storage: ProductStorage,
  now: number,
): Promise<boolean> {
  const raw = await storage.getItem(SUPPORT_QUEUE_LEGACY_KEY);
  if (raw === null) return false;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch {
    return false;
  }
  if (!Array.isArray(decoded) || decoded.length === 0) return false;
  const allExpired = decoded.every((entry) => {
    const createdAt = legacyCreatedAt(entry);
    return createdAt !== null && isExpired(createdAt, now);
  });
  if (!allExpired) return false;
  await storage.removeItem(SUPPORT_QUEUE_LEGACY_KEY);
  return true;
}

function legacyCreatedAt(entry: unknown): string | null {
  if (typeof entry !== "object" || entry === null) return null;
  const job = (entry as { job?: unknown }).job;
  if (typeof job !== "object" || job === null) return null;
  const createdAt = (job as { createdAt?: unknown }).createdAt;
  return typeof createdAt === "string" ? createdAt : null;
}
