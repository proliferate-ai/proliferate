import type { ProductStorage } from "#product/host/product-host";

import {
  createNextSupportQueueDocument,
  createSupportQueueDocument,
  encodeSupportQueueDocument,
  encodeSupportQueueJournal,
  parseSupportQueueDocument,
  parseSupportQueueJournal,
  type SupportQueueDocumentV2,
  type SupportQueueJobParser,
} from "./support-report-queue-document";

export const SUPPORT_QUEUE_PRIMARY_KEY = "proliferate.supportReportJobs.v2";
export const SUPPORT_QUEUE_PENDING_KEY = "proliferate.supportReportJobs.v2.pending";

export type SupportQueueStorageFailure =
  | "document_invalid"
  | "journal_conflict"
  | "readback_mismatch"
  | "revision_exhausted"
  | "storage_failed";

export class SupportQueueStorageError extends Error {
  readonly failure: SupportQueueStorageFailure;

  constructor(failure: SupportQueueStorageFailure) {
    super(`Support queue storage operation failed: ${failure}.`);
    this.name = "SupportQueueStorageError";
    this.failure = failure;
  }
}

/** Hydrate and repair the V2 primary/journal pair before any queue activity. */
export async function hydrateSupportQueue<TJob>(
  storage: ProductStorage,
  parseJob: SupportQueueJobParser<TJob>,
): Promise<SupportQueueDocumentV2<TJob>> {
  const [primaryRaw, pendingRaw] = await readPair(storage);
  const [primary, pending] = await Promise.all([
    primaryRaw === null
      ? Promise.resolve(null)
      : parseDocumentClosed(primaryRaw, parseJob),
    pendingRaw === null
      ? Promise.resolve(null)
      : parseJournalClosed(pendingRaw, parseJob),
  ]);

  if (!primary && !pending) return createSupportQueueDocument(0, []);
  if (pending && !primary) {
    return promotePending(storage, pending.target, parseJob);
  }
  if (primary && !pending) return primary;
  if (!primary || !pending || primaryRaw === null) {
    throw new SupportQueueStorageError("document_invalid");
  }

  if (primary.revision === pending.target.revision) {
    if (primaryRaw !== encodeSupportQueueDocument(pending.target)) {
      throw new SupportQueueStorageError("journal_conflict");
    }
    await removePending(storage);
    return primary;
  }
  if (pending.target.revision > primary.revision) {
    return promotePending(storage, pending.target, parseJob);
  }
  await removePending(storage);
  return primary;
}

/** Commit one serialized N→N+1 mutation and acknowledge only after readback. */
export async function commitSupportQueueMutation<TJob>(
  storage: ProductStorage,
  current: SupportQueueDocumentV2<TJob>,
  jobs: readonly TJob[],
  parseJob: SupportQueueJobParser<TJob>,
): Promise<SupportQueueDocumentV2<TJob>> {
  let next: SupportQueueDocumentV2<TJob>;
  try {
    next = await createNextSupportQueueDocument(current, jobs);
  } catch (error) {
    if (error instanceof Error && "failure" in error
      && error.failure === "revision_exhausted") {
      throw new SupportQueueStorageError("revision_exhausted");
    }
    throw new SupportQueueStorageError("document_invalid");
  }
  const targetRaw = encodeSupportQueueDocument(next);
  const journalRaw = encodeSupportQueueJournal(next);
  await write(storage, SUPPORT_QUEUE_PENDING_KEY, journalRaw);
  await write(storage, SUPPORT_QUEUE_PRIMARY_KEY, targetRaw);
  await verifyPrimary(storage, targetRaw, parseJob);
  await removePending(storage);
  return next;
}

async function readPair(storage: ProductStorage): Promise<[string | null, string | null]> {
  try {
    return await Promise.all([
      storage.getItem(SUPPORT_QUEUE_PRIMARY_KEY),
      storage.getItem(SUPPORT_QUEUE_PENDING_KEY),
    ]);
  } catch {
    throw new SupportQueueStorageError("storage_failed");
  }
}

async function parseDocumentClosed<TJob>(
  raw: string,
  parseJob: SupportQueueJobParser<TJob>,
): Promise<SupportQueueDocumentV2<TJob>> {
  try {
    return await parseSupportQueueDocument(raw, parseJob);
  } catch {
    throw new SupportQueueStorageError("document_invalid");
  }
}

async function parseJournalClosed<TJob>(
  raw: string,
  parseJob: SupportQueueJobParser<TJob>,
) {
  try {
    return await parseSupportQueueJournal(raw, parseJob);
  } catch {
    throw new SupportQueueStorageError("document_invalid");
  }
}

async function promotePending<TJob>(
  storage: ProductStorage,
  target: SupportQueueDocumentV2<TJob>,
  parseJob: SupportQueueJobParser<TJob>,
): Promise<SupportQueueDocumentV2<TJob>> {
  const raw = encodeSupportQueueDocument(target);
  await write(storage, SUPPORT_QUEUE_PRIMARY_KEY, raw);
  const verified = await verifyPrimary(storage, raw, parseJob);
  await removePending(storage);
  return verified;
}

async function verifyPrimary<TJob>(
  storage: ProductStorage,
  expectedRaw: string,
  parseJob: SupportQueueJobParser<TJob>,
): Promise<SupportQueueDocumentV2<TJob>> {
  let actual: string | null;
  try {
    actual = await storage.getItem(SUPPORT_QUEUE_PRIMARY_KEY);
  } catch {
    throw new SupportQueueStorageError("storage_failed");
  }
  if (actual !== expectedRaw) {
    throw new SupportQueueStorageError("readback_mismatch");
  }
  return parseDocumentClosed(actual, parseJob);
}

async function write(storage: ProductStorage, key: string, value: string): Promise<void> {
  try {
    await storage.setItem(key, value);
  } catch {
    throw new SupportQueueStorageError("storage_failed");
  }
}

async function removePending(storage: ProductStorage): Promise<void> {
  try {
    await storage.removeItem(SUPPORT_QUEUE_PENDING_KEY);
  } catch {
    throw new SupportQueueStorageError("storage_failed");
  }
}
