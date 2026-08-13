import { describe, expect, it, vi } from "vitest";
import type { ProductStorage } from "#product/host/product-host";
import type { SupportReportJob } from "#product/lib/domain/support/report-types";

import { SUPPORT_QUEUE_LEGACY_KEY } from "./support-report-queue-migration";
import { BrowserSupportReportQueueController } from "./support-report-upload-persistence";

class MemoryStorage implements ProductStorage {
  readonly values = new Map<string, string>();
  readonly trace: string[] = [];
  failRead = false;
  failWrite = false;

  async getItem(key: string): Promise<string | null> {
    this.trace.push(`get:${key}`);
    if (this.failRead) throw new Error("read failed");
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.trace.push(`set:${key}`);
    if (this.failWrite) throw new Error("write failed");
    this.values.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.trace.push(`remove:${key}`);
    this.values.delete(key);
  }
}

describe("browser support report V1 fallback queue", () => {
  it("serializes rapid enqueues and acknowledges only byte-identical duplicates", async () => {
    const storage = new MemoryStorage();
    const controller = createController(storage);
    await controller.initialize();

    await expect(Promise.all([
      controller.enqueue(job("a")),
      controller.enqueue(job("b")),
    ])).resolves.toEqual(["queued", "queued"]);
    await expect(controller.enqueue(job("a"))).resolves.toBe("duplicate");
    await expect(controller.enqueue(job("a", { message: "different" }))).resolves.toBe("conflict");

    const stored = JSON.parse(storage.values.get(SUPPORT_QUEUE_LEGACY_KEY) ?? "[]") as
      Array<{ job: SupportReportJob }>;
    expect(stored.map((entry) => entry.job.jobId)).toEqual(["a", "b"]);
  });

  it("captures immutable enqueue bytes before yielding to an earlier mutation", async () => {
    const storage = new MemoryStorage();
    const controller = createController(storage);
    await controller.initialize();
    const mutable = job("immutable", { message: "original" });

    const acknowledgement = controller.enqueue(mutable);
    mutable.message = "changed after dispatch";

    await expect(acknowledgement).resolves.toBe("queued");
    expect((await controller.dueEntries(Date.now()))[0]?.job.message).toBe("original");
  });

  it("rejects an eleventh job without evicting and cleans only its new staged file", async () => {
    const storage = new MemoryStorage();
    const deleteAttachment = vi.fn(async () => {});
    const controller = createController(storage, deleteAttachment);
    await controller.initialize();
    for (let index = 0; index < 10; index += 1) {
      await expect(controller.enqueue(job(`job-${index}`))).resolves.toBe("queued");
    }
    const rejected = job("job-10", {
      attachments: [attachment("new-path")],
    });
    await expect(controller.enqueue(rejected)).resolves.toBe("full");

    const stored = JSON.parse(storage.values.get(SUPPORT_QUEUE_LEGACY_KEY) ?? "[]") as
      Array<{ job: SupportReportJob }>;
    expect(stored).toHaveLength(10);
    expect(stored[0]?.job.jobId).toBe("job-0");
    expect(deleteAttachment).toHaveBeenCalledWith("new-path");
  });

  it("forces diagnostics off even when a browser caller supplies prepared intent", async () => {
    const storage = new MemoryStorage();
    const controller = createController(storage);
    await controller.initialize();
    await expect(controller.enqueue(job("prepared", {
      supportSnapshot: preparedSnapshot(),
    }))).resolves.toBe("queued");

    const stored = JSON.parse(storage.values.get(SUPPORT_QUEUE_LEGACY_KEY) ?? "[]") as
      Array<{ job: Record<string, unknown> }>;
    expect(stored[0]?.job.supportSnapshot).toBeUndefined();
    expect(stored[0]?.job.includeLogs).toBe(false);
    expect((await controller.dueEntries(Date.now()))[0]?.job.supportSnapshot)
      .toEqual({ kind: "none" });
  });

  it("keeps an allowed browser attachment inline in V1 storage", async () => {
    const storage = new MemoryStorage();
    const controller = createController(storage);
    await controller.initialize();
    await expect(controller.enqueue(job("inline", {
      attachments: [{
        clientFileId: "inline-file",
        fileName: "inline.png",
        contentType: "image/png",
        sizeBytes: 1,
        dataBase64: "AA==",
      }],
    }))).resolves.toBe("queued");

    const stored = JSON.parse(storage.values.get(SUPPORT_QUEUE_LEGACY_KEY) ?? "[]") as
      Array<{ job: SupportReportJob }>;
    expect(stored[0]?.job.attachments[0]?.dataBase64).toBe("AA==");
  });

  it("blocks rather than normalizing a rejected queue read to empty", async () => {
    const storage = new MemoryStorage();
    storage.failRead = true;
    const controller = createController(storage);
    await expect(controller.initialize()).rejects.toThrow("read failed");
    await expect(controller.enqueue(job("a"))).resolves.toBe("failed");
    expect(storage.trace).toEqual([`get:${SUPPORT_QUEUE_LEGACY_KEY}`]);
  });

  it("never acknowledges a rejected V1 write as queued", async () => {
    const storage = new MemoryStorage();
    const controller = createController(storage);
    await controller.initialize();
    storage.failWrite = true;

    await expect(controller.enqueue(job("failed-write"))).resolves.toBe("failed");
    await expect(controller.enqueue(job("blocked"))).resolves.toBe("failed");
    expect(storage.values.has(SUPPORT_QUEUE_LEGACY_KEY)).toBe(false);
  });
});

function createController(
  storage: MemoryStorage,
  deleteAttachment = vi.fn(async () => {}),
): BrowserSupportReportQueueController {
  return new BrowserSupportReportQueueController({
    storage,
    deleteAttachment,
    callbacks: {
      onControllerError: vi.fn(),
      onCleanupError: vi.fn(),
      onSnapshotUnavailable: vi.fn(),
    },
  });
}

function job(jobId: string, overrides: Partial<SupportReportJob> = {}): SupportReportJob {
  return {
    jobId,
    createdAt: "2026-08-12T00:00:00.000Z",
    message: "Help",
    scope: { kind: "app_only", workspaceIds: [] },
    publicContentConsent: false,
    kind: "bug",
    creditConsent: false,
    supportSnapshot: { kind: "none" },
    snapshot: {
      openedAt: "2026-08-12T00:00:00.000Z",
      source: "sidebar",
      context: { source: "sidebar", intent: "general" },
      defaultScope: "app_only",
      defaultWorkspaceId: null,
      workspaceOptions: [],
    },
    attachments: [],
    ...overrides,
  };
}

function attachment(path: string): SupportReportJob["attachments"][number] {
  return {
    clientFileId: `file-${path}`,
    fileName: "screenshot.png",
    contentType: "image/png",
    sizeBytes: 1,
    stagedPath: path,
  };
}

function preparedSnapshot(): Extract<SupportReportJob["supportSnapshot"], { kind: "prepared" }> {
  return {
    kind: "prepared",
    consent: {
      version: 1,
      disclosureVersion: "desktop_support_snapshot_customer_content_v1",
      grantedAt: "2026-08-12T00:00:00.000Z",
      selection: {
        kind: "recent_activity",
        workspace: { kind: "none", reason: "no_selected_bundled_local_workspace" },
      },
    },
    artifact: {
      artifactSchemaVersion: 3,
      artifactId: `ssv1_${"a".repeat(64)}`,
      snapshotId: "snapshot-1",
      preparationOperationId: "operation-1",
      generatedAt: "2026-08-12T00:00:00.000Z",
      sizeBytes: 2,
      sha256: "b".repeat(64),
      summary: {
        collectorRecords: 0,
        fallbackRecords: 0,
        sessions: 0,
        omissions: 0,
        truncations: 0,
      },
    },
  };
}
