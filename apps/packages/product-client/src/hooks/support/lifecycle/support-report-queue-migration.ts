import type { ProductStorage } from "#product/host/product-host";

import {
  canonicalQueueJson,
  queueUtf8Bytes,
} from "./support-report-queue-canonical";
import {
  createSupportQueueDocument,
  encodeSupportQueueDocument,
  SUPPORT_QUEUE_DOCUMENT_MAX_BYTES,
  type SupportQueueDocumentV2,
  type SupportQueueJobParser,
} from "./support-report-queue-document";
import {
  commitSupportQueueMutation,
  hydrateSupportQueue,
  SUPPORT_QUEUE_PENDING_KEY,
  SUPPORT_QUEUE_PRIMARY_KEY,
  SupportQueueStorageError,
} from "./support-report-queue-storage";

export const SUPPORT_QUEUE_LEGACY_KEY = "proliferate.supportReportJobs.v1";

export interface MigratedSupportQueueEntryIdentity {
  job: {
    jobId: string;
    includeLogs: boolean;
    supportSnapshot: { kind: "none" };
  };
}

export type SupportQueueMigrationFailure =
  | "legacy_conflict"
  | "legacy_invalid"
  | "legacy_remove_failed"
  | "storage_failed"
  | "v2_conflict";

export class SupportQueueMigrationError extends Error {
  readonly failure: SupportQueueMigrationFailure;

  constructor(failure: SupportQueueMigrationFailure) {
    super(`Support queue migration failed: ${failure}.`);
    this.name = "SupportQueueMigrationError";
    this.failure = failure;
  }
}

/** Hydrate V2 or migrate the complete legacy queue before native reconciliation. */
export async function hydrateOrMigrateSupportQueue<
  TEntry extends MigratedSupportQueueEntryIdentity,
>(
  storage: ProductStorage,
  parseEntry: SupportQueueJobParser<TEntry>,
): Promise<SupportQueueDocumentV2<TEntry>> {
  const [legacyRaw, primaryRaw, pendingRaw] = await readAllQueueKeys(storage);
  if (legacyRaw === null) return hydrateSupportQueue(storage, parseEntry);

  const migratedEntries = validateAndMigrateLegacy(legacyRaw, parseEntry);
  const initial = await createSupportQueueDocument<TEntry>(0, []);
  const deterministicTarget = await createSupportQueueDocument(1, migratedEntries);
  const targetRaw = encodeSupportQueueDocument(deterministicTarget);

  if (primaryRaw === null && pendingRaw === null) {
    const committed = await commitSupportQueueMutation(
      storage,
      initial,
      migratedEntries,
      parseEntry,
    );
    if (encodeSupportQueueDocument(committed) !== targetRaw) {
      throw new SupportQueueMigrationError("v2_conflict");
    }
  } else {
    const hydrated = await hydrateV2Closed(storage, parseEntry);
    if (encodeSupportQueueDocument(hydrated) !== targetRaw) {
      throw new SupportQueueMigrationError("v2_conflict");
    }
  }

  await removeLegacy(storage);
  return deterministicTarget;
}

function validateAndMigrateLegacy<TEntry extends MigratedSupportQueueEntryIdentity>(
  raw: string,
  parseEntry: SupportQueueJobParser<TEntry>,
): TEntry[] {
  if (queueUtf8Bytes(raw) > SUPPORT_QUEUE_DOCUMENT_MAX_BYTES) {
    throw new SupportQueueMigrationError("legacy_invalid");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch {
    throw new SupportQueueMigrationError("legacy_invalid");
  }
  if (!Array.isArray(decoded)) {
    throw new SupportQueueMigrationError("legacy_invalid");
  }
  // The V1 owner persisted the complete queue with compact JSON.stringify.
  // Reject any lexical representation that it could not have written so two
  // distinct persisted wrappers cannot normalize to the same comparison bytes.
  if (JSON.stringify(decoded) !== raw) {
    throw new SupportQueueMigrationError("legacy_invalid");
  }

  const validated = decoded.map((value, index) => migrateEntry(value, index, parseEntry));
  if (validated.length > 10) {
    throw new SupportQueueMigrationError("legacy_invalid");
  }

  const firstByJobId = new Map<string, { legacyBytes: string; entry: TEntry }>();
  for (const candidate of validated) {
    const previous = firstByJobId.get(candidate.entry.job.jobId);
    if (!previous) {
      firstByJobId.set(candidate.entry.job.jobId, candidate);
    } else if (previous.legacyBytes !== candidate.legacyBytes) {
      throw new SupportQueueMigrationError("legacy_conflict");
    }
  }
  return Array.from(firstByJobId.values(), ({ entry }) => entry);
}

function migrateEntry<TEntry extends MigratedSupportQueueEntryIdentity>(
  value: unknown,
  index: number,
  parseEntry: SupportQueueJobParser<TEntry>,
): { legacyBytes: string; entry: TEntry } {
  const wrapper = plainRecord(value);
  const job = plainRecord(wrapper.job);
  if (Object.prototype.hasOwnProperty.call(job, "supportSnapshot")) {
    throw new SupportQueueMigrationError("legacy_invalid");
  }
  if (job.includeLogs !== undefined && typeof job.includeLogs !== "boolean") {
    throw new SupportQueueMigrationError("legacy_invalid");
  }
  if (typeof job.jobId !== "string" || job.jobId.length === 0) {
    throw new SupportQueueMigrationError("legacy_invalid");
  }

  let legacyBytes: string;
  try {
    // The old queue was written by JSON.stringify. Keep its complete wrapper
    // key order in the comparison so only byte-identical persisted wrappers
    // collapse; canonical-equivalent but differently encoded duplicates block.
    legacyBytes = JSON.stringify(wrapper);
    canonicalQueueJson(wrapper);
  } catch {
    throw new SupportQueueMigrationError("legacy_invalid");
  }
  const candidate = {
    ...wrapper,
    job: {
      ...job,
      includeLogs: job.includeLogs === false ? false : true,
      supportSnapshot: { kind: "none" as const },
    },
  };
  let entry: TEntry;
  try {
    entry = parseEntry(candidate, index);
    if (canonicalQueueJson(entry) !== canonicalQueueJson(candidate)) {
      throw new SupportQueueMigrationError("legacy_invalid");
    }
  } catch {
    throw new SupportQueueMigrationError("legacy_invalid");
  }
  if (entry.job.jobId !== job.jobId
    || entry.job.includeLogs !== candidate.job.includeLogs
    || entry.job.supportSnapshot.kind !== "none") {
    throw new SupportQueueMigrationError("legacy_invalid");
  }
  return { legacyBytes, entry };
}

function plainRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new SupportQueueMigrationError("legacy_invalid");
  }
  return value as Record<string, unknown>;
}

async function readAllQueueKeys(
  storage: ProductStorage,
): Promise<[string | null, string | null, string | null]> {
  try {
    return await Promise.all([
      storage.getItem(SUPPORT_QUEUE_LEGACY_KEY),
      storage.getItem(SUPPORT_QUEUE_PRIMARY_KEY),
      storage.getItem(SUPPORT_QUEUE_PENDING_KEY),
    ]);
  } catch {
    throw new SupportQueueMigrationError("storage_failed");
  }
}

async function hydrateV2Closed<TEntry>(
  storage: ProductStorage,
  parseEntry: SupportQueueJobParser<TEntry>,
): Promise<SupportQueueDocumentV2<TEntry>> {
  try {
    return await hydrateSupportQueue(storage, parseEntry);
  } catch (error) {
    if (error instanceof SupportQueueStorageError) {
      throw new SupportQueueMigrationError(
        error.failure === "storage_failed" ? "storage_failed" : "v2_conflict",
      );
    }
    throw new SupportQueueMigrationError("v2_conflict");
  }
}

async function removeLegacy(storage: ProductStorage): Promise<void> {
  try {
    await storage.removeItem(SUPPORT_QUEUE_LEGACY_KEY);
  } catch {
    throw new SupportQueueMigrationError("legacy_remove_failed");
  }
}
