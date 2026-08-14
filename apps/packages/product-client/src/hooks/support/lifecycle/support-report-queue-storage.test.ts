import { describe, expect, it } from "vitest";
import type { ProductStorage } from "#product/host/product-host";

import {
  createSupportQueueDocument,
  encodeSupportQueueDocument,
  encodeSupportQueueJournal,
} from "./support-report-queue-document";
import {
  commitSupportQueueMutation,
  hydrateSupportQueue,
  SUPPORT_QUEUE_PENDING_KEY,
  SUPPORT_QUEUE_PRIMARY_KEY,
  SupportQueueStorageError,
} from "./support-report-queue-storage";

interface Job { id: string }

const parseJob = (value: unknown): Job => {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || typeof (value as Record<string, unknown>).id !== "string") {
    throw new Error("invalid job");
  }
  return { id: (value as { id: string }).id };
};

class MemoryStorage implements ProductStorage {
  readonly values = new Map<string, string>();
  readonly trace: string[] = [];
  failAt: string | null = null;
  readbackOverride: string | null | undefined;

  async getItem(key: string): Promise<string | null> {
    this.step(`get:${key}`);
    if (key === SUPPORT_QUEUE_PRIMARY_KEY && this.readbackOverride !== undefined) {
      return this.readbackOverride;
    }
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.step(`set:${key}`);
    this.values.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.step(`remove:${key}`);
    this.values.delete(key);
  }

  private step(name: string): void {
    this.trace.push(name);
    if (this.failAt === name) throw new Error("injected storage failure");
  }
}

describe("support queue V2 storage", () => {
  it("hydrates an absent queue as revision zero without writing", async () => {
    const storage = new MemoryStorage();
    await expect(hydrateSupportQueue(storage, parseJob)).resolves.toMatchObject({
      revision: 0,
      jobs: [],
    });
    expect(storage.trace).toEqual([
      `get:${SUPPORT_QUEUE_PRIMARY_KEY}`,
      `get:${SUPPORT_QUEUE_PENDING_KEY}`,
    ]);
  });

  it("commits journal, primary, exact readback, and removal before ack", async () => {
    const storage = new MemoryStorage();
    const current = await createSupportQueueDocument<Job>(0, []);
    const next = await commitSupportQueueMutation(storage, current, [{ id: "job-1" }], parseJob);
    expect(next.revision).toBe(1);
    expect(storage.trace).toEqual([
      `set:${SUPPORT_QUEUE_PENDING_KEY}`,
      `set:${SUPPORT_QUEUE_PRIMARY_KEY}`,
      `get:${SUPPORT_QUEUE_PRIMARY_KEY}`,
      `remove:${SUPPORT_QUEUE_PENDING_KEY}`,
    ]);
    expect(storage.values.get(SUPPORT_QUEUE_PRIMARY_KEY)).toBe(
      encodeSupportQueueDocument(next),
    );
    expect(storage.values.has(SUPPORT_QUEUE_PENDING_KEY)).toBe(false);
  });

  it.each([
    `set:${SUPPORT_QUEUE_PENDING_KEY}`,
    `set:${SUPPORT_QUEUE_PRIMARY_KEY}`,
    `get:${SUPPORT_QUEUE_PRIMARY_KEY}`,
    `remove:${SUPPORT_QUEUE_PENDING_KEY}`,
  ])("never acknowledges when %s rejects", async (failure) => {
    const storage = new MemoryStorage();
    storage.failAt = failure;
    const current = await createSupportQueueDocument<Job>(0, []);
    await expect(commitSupportQueueMutation(
      storage,
      current,
      [{ id: "job-1" }],
      parseJob,
    )).rejects.toBeInstanceOf(SupportQueueStorageError);
  });

  it.each([
    `set:${SUPPORT_QUEUE_PRIMARY_KEY}`,
    `get:${SUPPORT_QUEUE_PRIMARY_KEY}`,
    `remove:${SUPPORT_QUEUE_PENDING_KEY}`,
  ])("recovers the highest durable target after a %s crash", async (failure) => {
    const storage = new MemoryStorage();
    storage.failAt = failure;
    const current = await createSupportQueueDocument<Job>(0, []);
    await expect(commitSupportQueueMutation(
      storage,
      current,
      [{ id: "job-1" }],
      parseJob,
    )).rejects.toBeInstanceOf(SupportQueueStorageError);
    storage.failAt = null;
    const recovered = await hydrateSupportQueue(storage, parseJob);
    expect(recovered).toMatchObject({ revision: 1, jobs: [{ id: "job-1" }] });
    expect(storage.values.has(SUPPORT_QUEUE_PENDING_KEY)).toBe(false);
  });

  it("leaves an empty queue when the pending write never became durable", async () => {
    const storage = new MemoryStorage();
    storage.failAt = `set:${SUPPORT_QUEUE_PENDING_KEY}`;
    const current = await createSupportQueueDocument<Job>(0, []);
    await expect(commitSupportQueueMutation(
      storage,
      current,
      [{ id: "job-1" }],
      parseJob,
    )).rejects.toBeInstanceOf(SupportQueueStorageError);
    storage.failAt = null;
    await expect(hydrateSupportQueue(storage, parseJob)).resolves.toMatchObject({
      revision: 0,
      jobs: [],
    });
  });

  it("rejects a non-identical primary readback", async () => {
    const storage = new MemoryStorage();
    storage.readbackOverride = null;
    const current = await createSupportQueueDocument<Job>(0, []);
    await expect(commitSupportQueueMutation(
      storage,
      current,
      [{ id: "job-1" }],
      parseJob,
    )).rejects.toMatchObject({ failure: "readback_mismatch" });
  });

  it("promotes a journal-only target and clears it after readback", async () => {
    const storage = new MemoryStorage();
    const target = await createSupportQueueDocument(3, [{ id: "job-1" }]);
    storage.values.set(SUPPORT_QUEUE_PENDING_KEY, encodeSupportQueueJournal(target));
    const hydrated = await hydrateSupportQueue(storage, parseJob);
    expect(hydrated).toEqual(target);
    expect(storage.values.get(SUPPORT_QUEUE_PRIMARY_KEY)).toBe(
      encodeSupportQueueDocument(target),
    );
    expect(storage.values.has(SUPPORT_QUEUE_PENDING_KEY)).toBe(false);
  });

  it("uses a primary-only target without rewriting it", async () => {
    const storage = new MemoryStorage();
    const target = await createSupportQueueDocument(4, [{ id: "job-1" }]);
    storage.values.set(SUPPORT_QUEUE_PRIMARY_KEY, encodeSupportQueueDocument(target));
    const hydrated = await hydrateSupportQueue(storage, parseJob);
    expect(hydrated).toEqual(target);
    expect(storage.trace.filter((step) => step.startsWith("set:"))).toEqual([]);
  });

  it("selects the higher revision and rejects equal-revision divergence", async () => {
    const storage = new MemoryStorage();
    const low = await createSupportQueueDocument(1, [{ id: "old" }]);
    const high = await createSupportQueueDocument(2, [{ id: "new" }]);
    storage.values.set(SUPPORT_QUEUE_PRIMARY_KEY, encodeSupportQueueDocument(low));
    storage.values.set(SUPPORT_QUEUE_PENDING_KEY, encodeSupportQueueJournal(high));
    await expect(hydrateSupportQueue(storage, parseJob)).resolves.toEqual(high);

    const divergent = await createSupportQueueDocument(2, [{ id: "different" }]);
    storage.values.set(SUPPORT_QUEUE_PRIMARY_KEY, encodeSupportQueueDocument(high));
    storage.values.set(SUPPORT_QUEUE_PENDING_KEY, encodeSupportQueueJournal(divergent));
    await expect(hydrateSupportQueue(storage, parseJob)).rejects.toMatchObject({
      failure: "journal_conflict",
    });
  });

  it("keeps a higher primary revision and removes a stale journal", async () => {
    const storage = new MemoryStorage();
    const high = await createSupportQueueDocument(4, [{ id: "new" }]);
    const low = await createSupportQueueDocument(3, [{ id: "old" }]);
    storage.values.set(SUPPORT_QUEUE_PRIMARY_KEY, encodeSupportQueueDocument(high));
    storage.values.set(SUPPORT_QUEUE_PENDING_KEY, encodeSupportQueueJournal(low));
    await expect(hydrateSupportQueue(storage, parseJob)).resolves.toEqual(high);
    expect(storage.values.has(SUPPORT_QUEUE_PENDING_KEY)).toBe(false);
  });

  it("blocks on either corrupt present value even when the other is valid", async () => {
    const target = await createSupportQueueDocument(1, [{ id: "job-1" }]);
    const primaryCorrupt = new MemoryStorage();
    primaryCorrupt.values.set(SUPPORT_QUEUE_PRIMARY_KEY, "{}");
    primaryCorrupt.values.set(SUPPORT_QUEUE_PENDING_KEY, encodeSupportQueueJournal(target));
    await expect(hydrateSupportQueue(primaryCorrupt, parseJob)).rejects.toMatchObject({
      failure: "document_invalid",
    });

    const journalCorrupt = new MemoryStorage();
    journalCorrupt.values.set(SUPPORT_QUEUE_PRIMARY_KEY, encodeSupportQueueDocument(target));
    journalCorrupt.values.set(SUPPORT_QUEUE_PENDING_KEY, "{}");
    await expect(hydrateSupportQueue(journalCorrupt, parseJob)).rejects.toMatchObject({
      failure: "document_invalid",
    });
  });

  it("blocks when either hydration read rejects", async () => {
    const primary = new MemoryStorage();
    primary.failAt = `get:${SUPPORT_QUEUE_PRIMARY_KEY}`;
    await expect(hydrateSupportQueue(primary, parseJob)).rejects.toMatchObject({
      failure: "storage_failed",
    });

    const pending = new MemoryStorage();
    pending.failAt = `get:${SUPPORT_QUEUE_PENDING_KEY}`;
    await expect(hydrateSupportQueue(pending, parseJob)).rejects.toMatchObject({
      failure: "storage_failed",
    });
  });
});
