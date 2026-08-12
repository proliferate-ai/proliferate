import { describe, expect, it } from "vitest";
import type { ProductStorage } from "#product/host/product-host";

import {
  createSupportQueueDocument,
  encodeSupportQueueDocument,
} from "./support-report-queue-document";
import {
  hydrateOrMigrateSupportQueue,
  SUPPORT_QUEUE_LEGACY_KEY,
  SupportQueueMigrationError,
  type MigratedSupportQueueEntryIdentity,
} from "./support-report-queue-migration";
import {
  SUPPORT_QUEUE_PENDING_KEY,
  SUPPORT_QUEUE_PRIMARY_KEY,
} from "./support-report-queue-storage";

interface Entry extends MigratedSupportQueueEntryIdentity {
  job: MigratedSupportQueueEntryIdentity["job"] & { message: string };
  attemptCount: number;
  nextAttemptAt: string | null;
}

const parseEntry = (value: unknown): Entry => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("entry");
  const entry = value as Record<string, unknown>;
  if (!entry.job || typeof entry.job !== "object" || Array.isArray(entry.job)
    || !Number.isSafeInteger(entry.attemptCount) || typeof entry.nextAttemptAt !== "object") {
    throw new Error("entry");
  }
  const job = entry.job as Record<string, unknown>;
  const snapshot = job.supportSnapshot as Record<string, unknown> | undefined;
  if (typeof job.jobId !== "string" || typeof job.message !== "string"
    || typeof job.includeLogs !== "boolean" || snapshot?.kind !== "none") {
    throw new Error("job");
  }
  return value as Entry;
};

class MemoryStorage implements ProductStorage {
  readonly values = new Map<string, string>();
  readonly trace: string[] = [];
  failRemoveLegacy = false;

  async getItem(key: string): Promise<string | null> {
    this.trace.push(`get:${key}`);
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.trace.push(`set:${key}`);
    this.values.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.trace.push(`remove:${key}`);
    if (key === SUPPORT_QUEUE_LEGACY_KEY && this.failRemoveLegacy) {
      throw new Error("injected removal failure");
    }
    this.values.delete(key);
  }
}

describe("support queue V1 migration", () => {
  it("validates every raw entry and counts before duplicate collapse", async () => {
    const storage = legacyStorage(Array.from({ length: 11 }, () => legacyEntry("same")));
    await expect(hydrateOrMigrateSupportQueue(storage, parseEntry)).rejects.toMatchObject({
      failure: "legacy_invalid",
    });
    expect(storage.trace.filter((step) => step.startsWith("set:"))).toEqual([]);

    const malformedLast = legacyStorage([
      legacyEntry("valid"),
      { ...legacyEntry("invalid"), attemptCount: 0.5 },
    ]);
    await expect(hydrateOrMigrateSupportQueue(malformedLast, parseEntry)).rejects.toMatchObject({
      failure: "legacy_invalid",
    });
    expect(malformedLast.trace.filter((step) => step.startsWith("set:"))).toEqual([]);
  });

  it("collapses byte-identical wrappers but rejects differing retry bytes", async () => {
    const identical = legacyStorage([legacyEntry("a"), legacyEntry("a")]);
    const migrated = await hydrateOrMigrateSupportQueue(identical, parseEntry);
    expect(migrated.jobs).toHaveLength(1);

    const conflicting = legacyStorage([
      legacyEntry("a"),
      { ...legacyEntry("a"), attemptCount: 1 },
    ]);
    await expect(hydrateOrMigrateSupportQueue(conflicting, parseEntry)).rejects.toMatchObject({
      failure: "legacy_conflict",
    });
    expect(conflicting.trace.filter((step) => step.startsWith("set:"))).toEqual([]);
  });

  it("rejects any legacy supportSnapshot before writing V2", async () => {
    const invalid = legacyEntry("a") as Record<string, unknown>;
    invalid.job = { ...(invalid.job as object), supportSnapshot: { kind: "none" } };
    const storage = legacyStorage([invalid]);
    await expect(hydrateOrMigrateSupportQueue(storage, parseEntry)).rejects.toBeInstanceOf(
      SupportQueueMigrationError,
    );
    expect(storage.values.has(SUPPORT_QUEUE_PRIMARY_KEY)).toBe(false);
  });

  it("normalizes false separately from missing or true legacy intent", async () => {
    const disabled = legacyEntry("off");
    (disabled.job as Record<string, unknown>).includeLogs = false;
    const missing = legacyEntry("missing");
    delete (missing.job as Record<string, unknown>).includeLogs;
    const enabled = legacyEntry("on");
    (enabled.job as Record<string, unknown>).includeLogs = true;
    const storage = legacyStorage([disabled, missing, enabled]);
    const migrated = await hydrateOrMigrateSupportQueue(storage, parseEntry);
    expect(migrated.jobs.map(({ job }) => ({
      includeLogs: job.includeLogs,
      snapshot: job.supportSnapshot,
    }))).toEqual([
      { includeLogs: false, snapshot: { kind: "none" } },
      { includeLogs: true, snapshot: { kind: "none" } },
      { includeLogs: true, snapshot: { kind: "none" } },
    ]);
  });

  it("verifies V2 and removes V1 only after the journal commits", async () => {
    const storage = legacyStorage([legacyEntry("a")]);
    await hydrateOrMigrateSupportQueue(storage, parseEntry);
    expect(storage.trace.slice(-5)).toEqual([
      `set:${SUPPORT_QUEUE_PENDING_KEY}`,
      `set:${SUPPORT_QUEUE_PRIMARY_KEY}`,
      `get:${SUPPORT_QUEUE_PRIMARY_KEY}`,
      `remove:${SUPPORT_QUEUE_PENDING_KEY}`,
      `remove:${SUPPORT_QUEUE_LEGACY_KEY}`,
    ]);
    expect(storage.values.has(SUPPORT_QUEUE_LEGACY_KEY)).toBe(false);
  });

  it("blocks readiness when V1 removal fails and finishes it on restart", async () => {
    const storage = legacyStorage([legacyEntry("a")]);
    storage.failRemoveLegacy = true;
    await expect(hydrateOrMigrateSupportQueue(storage, parseEntry)).rejects.toMatchObject({
      failure: "legacy_remove_failed",
    });
    const durableTarget = storage.values.get(SUPPORT_QUEUE_PRIMARY_KEY);
    expect(durableTarget).toBeTruthy();

    storage.failRemoveLegacy = false;
    const recovered = await hydrateOrMigrateSupportQueue(storage, parseEntry);
    expect(encodeSupportQueueDocument(recovered)).toBe(durableTarget);
    expect(storage.values.has(SUPPORT_QUEUE_LEGACY_KEY)).toBe(false);
  });

  it("rejects a non-equivalent pre-existing V2 queue", async () => {
    const storage = legacyStorage([legacyEntry("legacy")]);
    const other = await createSupportQueueDocument(1, [migratedEntry("other", true)]);
    storage.values.set(SUPPORT_QUEUE_PRIMARY_KEY, encodeSupportQueueDocument(other));
    await expect(hydrateOrMigrateSupportQueue(storage, parseEntry)).rejects.toMatchObject({
      failure: "v2_conflict",
    });
    expect(storage.values.has(SUPPORT_QUEUE_LEGACY_KEY)).toBe(true);
  });
});

function legacyEntry(jobId: string): Record<string, unknown> {
  return {
    job: { jobId, message: "help" },
    attemptCount: 0,
    nextAttemptAt: null,
  };
}

function migratedEntry(jobId: string, includeLogs: boolean): Entry {
  return {
    job: {
      jobId,
      message: "help",
      includeLogs,
      supportSnapshot: { kind: "none" },
    },
    attemptCount: 0,
    nextAttemptAt: null,
  };
}

function legacyStorage(entries: readonly unknown[]): MemoryStorage {
  const storage = new MemoryStorage();
  storage.values.set(SUPPORT_QUEUE_LEGACY_KEY, JSON.stringify(entries));
  return storage;
}
