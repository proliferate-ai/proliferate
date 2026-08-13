import { describe, expect, it, vi } from "vitest";
import type {
  DesktopSupportSnapshotBridge,
  ReconciledSupportArtifactV1,
} from "@proliferate/product-client/host/desktop-bridge";
import type { ProductStorage } from "#product/host/product-host";
import type { SupportReportJob } from "#product/lib/domain/support/report-types";

import { PackagedSupportReportQueueController } from "./support-report-queue-controller";
import { sha256QueueText } from "./support-report-queue-canonical";
import { createPersistedSupportReportJob } from "./support-report-queue-entry";
import {
  createSupportQueueDocument,
  encodeSupportQueueDocument,
} from "./support-report-queue-document";
import { SUPPORT_QUEUE_LEGACY_KEY } from "./support-report-queue-migration";
import {
  SUPPORT_QUEUE_PRIMARY_KEY,
} from "./support-report-queue-storage";

const EXISTING_JOB_ID = "10000000-0000-4000-8000-000000000001";
const CONFLICT_JOB_ID = "10000000-0000-4000-8000-000000000002";
const MISSING_JOB_ID = "10000000-0000-4000-8000-000000000003";
const FULL_JOB_ID = "10000000-0000-4000-8000-000000000004";

class MemoryStorage implements ProductStorage {
  readonly values = new Map<string, string>();
  readonly trace: string[] = [];
  failWrites = false;

  async getItem(key: string): Promise<string | null> {
    this.trace.push(`get:${key}`);
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.trace.push(`set:${key}`);
    if (this.failWrites) throw new Error("write failed");
    this.values.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.trace.push(`remove:${key}`);
    this.values.delete(key);
  }
}

describe("packaged native support queue controller", () => {
  it("hydrates and reconciles every artifact/attachment before accepting enqueue", async () => {
    const storage = new MemoryStorage();
    const bridge = snapshotBridge();
    bridge.reconcileArtifacts.mockImplementation(async ({ artifacts }) => {
      storage.trace.push("native:reconcile");
      return artifacts.map((artifact) => ({ ...artifact, state: "verified" as const }));
    });
    const existing = await preparedJob(EXISTING_JOB_ID, "staged-existing");
    storage.values.set(SUPPORT_QUEUE_PRIMARY_KEY, encodeSupportQueueDocument(
      await createSupportQueueDocument(1, [createPersistedSupportReportJob(existing)]),
    ));
    const controller = createController(storage, bridge);
    await controller.initialize();

    expect(bridge.reconcileArtifacts).toHaveBeenCalledWith({
      artifacts: [{
        clientJobId: EXISTING_JOB_ID,
        artifactId: existing.supportSnapshot.kind === "prepared"
          ? existing.supportSnapshot.artifact.artifactId
          : "",
        snapshotId: snapshotId(EXISTING_JOB_ID),
        sizeBytes: 2,
        sha256: "b".repeat(64),
      }],
      referencedAttachmentPaths: ["staged-existing"],
    });
    await expect(controller.enqueue(noSnapshotJob("new"))).resolves.toBe("queued");
    expect(storage.trace.indexOf(`get:${SUPPORT_QUEUE_PRIMARY_KEY}`)).toBeLessThan(
      storage.trace.indexOf("native:reconcile"),
    );
  });

  it("keeps byte-identical duplicates and rejects conflicting bytes without deleting shared data", async () => {
    const storage = new MemoryStorage();
    const bridge = snapshotBridge();
    const deleteAttachment = vi.fn(async () => {});
    const controller = createController(storage, bridge, deleteAttachment);
    await controller.initialize();
    const accepted = await preparedJob(CONFLICT_JOB_ID, "shared-path");
    await expect(controller.enqueue(accepted)).resolves.toBe("queued");
    await expect(controller.enqueue(accepted)).resolves.toBe("duplicate");

    const conflicting = await preparedJob(CONFLICT_JOB_ID, "new-path", "different");
    await expect(controller.enqueue(conflicting)).resolves.toBe("conflict");
    expect(deleteAttachment).toHaveBeenCalledWith("new-path");
    expect(deleteAttachment).not.toHaveBeenCalledWith("shared-path");
    expect(bridge.deleteArtifact).not.toHaveBeenCalled();
  });

  it("journal-removes a missing artifact before cleaning its files", async () => {
    const storage = new MemoryStorage();
    const bridge = snapshotBridge("missing");
    const deleteAttachment = vi.fn(async () => {
      storage.trace.push("cleanup:attachment");
    });
    bridge.deleteArtifact.mockImplementation(async () => {
      storage.trace.push("cleanup:snapshot");
    });
    const existing = await preparedJob(MISSING_JOB_ID, "staged-missing");
    storage.values.set(SUPPORT_QUEUE_PRIMARY_KEY, encodeSupportQueueDocument(
      await createSupportQueueDocument(1, [createPersistedSupportReportJob(existing)]),
    ));
    const controller = createController(storage, bridge, deleteAttachment);
    await controller.initialize();

    const finalReadback = storage.trace.lastIndexOf(`get:${SUPPORT_QUEUE_PRIMARY_KEY}`);
    expect(finalReadback).toBeGreaterThan(-1);
    expect(storage.trace.indexOf("cleanup:attachment")).toBeGreaterThan(finalReadback);
    expect(storage.trace.indexOf("cleanup:snapshot")).toBeGreaterThan(finalReadback);
    await expect(controller.dueEntries(Date.now())).resolves.toEqual([]);
  });

  it("blocks packaged migration before native reconciliation when V1 contains inline bytes", async () => {
    const storage = new MemoryStorage();
    const bridge = snapshotBridge();
    const legacyJob: Partial<SupportReportJob> = { ...noSnapshotJob("legacy-inline") };
    delete legacyJob.supportSnapshot;
    legacyJob.attachments = [{
      clientFileId: "inline-file",
      fileName: "inline.png",
      contentType: "image/png",
      sizeBytes: 1,
      dataBase64: "AA==",
    }];
    storage.values.set(SUPPORT_QUEUE_LEGACY_KEY, JSON.stringify([{
      job: legacyJob,
      attemptCount: 0,
    }]));

    const controller = createController(storage, bridge);
    await expect(controller.initialize()).rejects.toThrow("legacy_invalid");
    expect(bridge.reconcileArtifacts).not.toHaveBeenCalled();
    expect(storage.values.has(SUPPORT_QUEUE_PRIMARY_KEY)).toBe(false);
  });

  it("never acknowledges a failed journal write as queued", async () => {
    const storage = new MemoryStorage();
    const controller = createController(storage, snapshotBridge());
    await controller.initialize();
    storage.failWrites = true;

    await expect(controller.enqueue(noSnapshotJob("write-failure"))).resolves.toBe("failed");
    await expect(controller.enqueue(noSnapshotJob("after-failure"))).resolves.toBe("failed");
    expect(storage.values.has(SUPPORT_QUEUE_PRIMARY_KEY)).toBe(false);
  });

  it("serializes retry, removal, and enqueue mutations on one owner chain", async () => {
    const storage = new MemoryStorage();
    const controller = createController(storage, snapshotBridge());
    await controller.initialize();
    await controller.enqueue(noSnapshotJob("retry-first"));
    await controller.enqueue(noSnapshotJob("remove-second"));

    await Promise.all([
      controller.markFailed("retry-first", {
        kind: "transient",
        message: "offline",
        retryable: true,
        retryDelayMs: 30_000,
        toastMessage: "retry",
        toastCooldownMs: 30_000,
      }, new Date("2026-08-12T00:00:00.000Z"), true),
      controller.removeAndCleanup("remove-second"),
      controller.enqueue(noSnapshotJob("enqueue-third")),
    ]);

    const entries = await controller.dueEntries(Date.parse("2026-08-13T00:00:00.000Z"));
    expect(entries.map(({ job }) => job.jobId)).toEqual(["retry-first", "enqueue-third"]);
    expect(entries[0]?.attemptCount).toBe(1);
  });

  it("fails readiness closed on a malformed native reconciliation response", async () => {
    const storage = new MemoryStorage();
    const bridge = snapshotBridge();
    const existing = await preparedJob(EXISTING_JOB_ID, "staged-existing");
    storage.values.set(SUPPORT_QUEUE_PRIMARY_KEY, encodeSupportQueueDocument(
      await createSupportQueueDocument(1, [createPersistedSupportReportJob(existing)]),
    ));
    bridge.reconcileArtifacts.mockImplementation(async ({ artifacts }) => [{
      ...artifacts[0]!,
      state: "verified",
      unexpected: true,
    }] as ReconciledSupportArtifactV1[]);
    const controller = createController(storage, bridge);

    await expect(controller.initialize()).rejects.toThrow("reconciliation was invalid");
    await expect(controller.enqueue(noSnapshotJob("blocked"))).resolves.toBe("failed");
  });

  it("rejects and cleans only the distinct eleventh packaged job", async () => {
    const storage = new MemoryStorage();
    const bridge = snapshotBridge();
    const deleteAttachment = vi.fn(async () => {});
    const controller = createController(storage, bridge, deleteAttachment);
    await controller.initialize();
    for (let index = 0; index < 10; index += 1) {
      await expect(controller.enqueue(noSnapshotJob(`job-${index}`))).resolves.toBe("queued");
    }
    const rejected = await preparedJob(FULL_JOB_ID, "eleventh-path");

    await expect(controller.enqueue(rejected)).resolves.toBe("full");
    expect((await controller.dueEntries(Date.now())).map(({ job }) => job.jobId))
      .toEqual(Array.from({ length: 10 }, (_, index) => `job-${index}`));
    expect(deleteAttachment).toHaveBeenCalledWith("eleventh-path");
    if (rejected.supportSnapshot.kind !== "prepared") throw new Error("prepared fixture");
    expect(bridge.deleteArtifact).toHaveBeenCalledWith(
      rejected.supportSnapshot.artifact.artifactId,
    );
  });
});

function createController(
  storage: MemoryStorage,
  supportSnapshot: ReturnType<typeof snapshotBridge>,
  deleteAttachment = vi.fn(async () => {}),
): PackagedSupportReportQueueController {
  return new PackagedSupportReportQueueController({
    storage,
    supportSnapshot,
    deleteAttachment,
    callbacks: {
      onControllerError: vi.fn(),
      onCleanupError: vi.fn(),
      onSnapshotUnavailable: vi.fn(),
    },
  });
}

function snapshotBridge(state: ReconciledSupportArtifactV1["state"] = "verified") {
  return {
    beginPreparation: vi.fn(),
    finishPreparation: vi.fn(),
    cancelPreparation: vi.fn(),
    saveArchive: vi.fn(),
    readArtifact: vi.fn(),
    deleteArtifact: vi.fn(async () => {}),
    reconcileArtifacts: vi.fn(async ({ artifacts }) =>
      artifacts.map((artifact) => ({ ...artifact, state }))
    ),
    beginSubmission: vi.fn(),
    finishSubmission: vi.fn(),
  } satisfies DesktopSupportSnapshotBridge;
}

function noSnapshotJob(jobId: string): SupportReportJob {
  return job(jobId, { supportSnapshot: { kind: "none" } });
}

async function preparedJob(
  jobId: string,
  attachmentPath: string,
  message = "Help",
): Promise<SupportReportJob> {
  const artifactId = `ssv1_${await sha256QueueText(
    `proliferate-support-snapshot-v1\u0000${jobId}`,
  )}`;
  return job(jobId, {
    message,
    attachments: [{
      clientFileId: `file-${jobId}`,
      fileName: "screenshot.png",
      contentType: "image/png",
      sizeBytes: 1,
      stagedPath: attachmentPath,
    }],
    supportSnapshot: {
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
        artifactId,
        snapshotId: snapshotId(jobId),
        preparationOperationId: operationId(jobId),
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
    },
  });
}

function snapshotId(jobId: string): string {
  return `20000000-0000-4000-8000-${jobId.slice(-12)}`;
}

function operationId(jobId: string): string {
  return `30000000-0000-4000-8000-${jobId.slice(-12)}`;
}

function job(jobId: string, overrides: Partial<SupportReportJob>): SupportReportJob {
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
