import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopSupportSnapshotBridge } from "@proliferate/product-client/host/desktop-bridge";
import type { ProductStorage } from "#product/host/product-host";
import type { SupportReportJob } from "#product/lib/domain/support/report-types";

import { PackagedSupportReportQueueController } from "./support-report-queue-controller";
import { SUPPORT_QUEUE_LEGACY_KEY } from "./support-report-queue-migration";
import {
  SUPPORT_QUEUE_PENDING_KEY,
  SUPPORT_QUEUE_PRIMARY_KEY,
} from "./support-report-queue-storage";
import { drainSupportReportQueue } from "./use-support-report-upload-queue";

const LEGACY_JOB_ID = "10000000-0000-4000-8000-000000000001";
const CURRENT_JOB_ID = "10000000-0000-4000-8000-000000000002";

const cloud = vi.hoisted(() => ({
  completeSupportReportUpload: vi.fn(),
  createSupportReport: vi.fn(),
  createSupportReportUploadTargets: vi.fn(),
}));

vi.mock("@proliferate/cloud-sdk/client/support", () => cloud);

class MemoryStorage implements ProductStorage {
  readonly values = new Map<string, string>();
  readonly trace: string[] = [];

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
    this.values.delete(key);
  }
}

describe("support report queue drain legacy consent conclusion", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    cloud.completeSupportReportUpload.mockResolvedValue({ ok: true, reportId: "report-1" });
    cloud.createSupportReport.mockResolvedValue(createResponse("created"));
  });

  it("migrates the legacy marker and queue-removes a stable conflict with resubmit guidance", async () => {
    const storage = new MemoryStorage();
    const legacy = currentJob(LEGACY_JOB_ID);
    const { supportSnapshot: _supportSnapshot, ...persistedLegacyJob } = legacy;
    persistedLegacyJob.includeLogs = true;
    storage.values.set(SUPPORT_QUEUE_LEGACY_KEY, JSON.stringify([{
      job: persistedLegacyJob,
      attemptCount: 0,
    }]));
    const bridge = snapshotBridge();
    const queue = createController(storage, bridge);
    await queue.initialize();
    const [migrated] = await queue.dueEntries(Date.now());
    expect(migrated?.job).toMatchObject({
      jobId: LEGACY_JOB_ID,
      includeLogs: true,
      supportSnapshot: { kind: "none" },
    });

    cloud.createSupportReportUploadTargets.mockRejectedValue(stableConflict());
    const showToast = vi.fn();
    const markFailed = vi.spyOn(queue, "markFailed");
    await drainSupportReportQueue(drainInput(queue, bridge, showToast));

    expect(bridge.beginSubmission).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
    // The drain forwards the optional type positionally, so the default-type
    // calls arrive as two arguments. Spelling that out keeps the `not.` forms
    // below meaningful instead of vacuously true on an arity mismatch.
    expect(showToast).toHaveBeenCalledWith(
      "This older report needs fresh diagnostic consent. Start a new report from Help.",
      undefined,
    );
    await expect(queue.dueEntries(Date.now())).resolves.toEqual([]);

    queue.dispose();
    const restarted = createController(storage, snapshotBridge());
    await restarted.initialize();
    await expect(restarted.dueEntries(Date.now())).resolves.toEqual([]);
  });

  it("journal-removes an already-completed migrated legacy job as normal success", async () => {
    const storage = new MemoryStorage();
    const legacy = currentJob(LEGACY_JOB_ID);
    const { supportSnapshot: _supportSnapshot, ...persistedLegacyJob } = legacy;
    persistedLegacyJob.includeLogs = true;
    storage.values.set(SUPPORT_QUEUE_LEGACY_KEY, JSON.stringify([{
      job: persistedLegacyJob,
      attemptCount: 0,
    }]));
    const bridge = snapshotBridge();
    const queue = createController(storage, bridge);
    await queue.initialize();
    const [migrated] = await queue.dueEntries(Date.now());
    expect(migrated?.job).toMatchObject({
      jobId: LEGACY_JOB_ID,
      includeLogs: true,
      supportSnapshot: { kind: "none" },
    });
    expect(storage.values.has(SUPPORT_QUEUE_LEGACY_KEY)).toBe(false);

    cloud.createSupportReport.mockResolvedValueOnce(createResponse("completed"));
    storage.trace.length = 0;
    const showToast = vi.fn();
    const input = drainInput(queue, bridge, showToast);
    const markFailed = vi.spyOn(queue, "markFailed");
    await drainSupportReportQueue(input);

    expect(cloud.createSupportReport).toHaveBeenCalledTimes(1);
    expect(cloud.createSupportReportUploadTargets).not.toHaveBeenCalled();
    expect(cloud.completeSupportReportUpload).not.toHaveBeenCalled();
    expect(bridge.beginSubmission).not.toHaveBeenCalled();
    expect(bridge.finishSubmission).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
    expect(input.telemetry.track).toHaveBeenCalledWith(
      "support_report_submitted",
      expect.objectContaining({ diagnostics_included: false }),
    );
    expect(showToast).toHaveBeenCalledWith(
      "Thanks. Report sent. Support has the details. (report-1)",
      "info",
    );
    expect(showToast).not.toHaveBeenCalledWith(
      "This older report needs fresh diagnostic consent. Start a new report from Help.",
      undefined,
    );
    expect(storage.trace).toEqual([
      `set:${SUPPORT_QUEUE_PENDING_KEY}`,
      `set:${SUPPORT_QUEUE_PRIMARY_KEY}`,
      `get:${SUPPORT_QUEUE_PRIMARY_KEY}`,
      `remove:${SUPPORT_QUEUE_PENDING_KEY}`,
    ]);
    expect(JSON.parse(storage.values.get(SUPPORT_QUEUE_PRIMARY_KEY) ?? "null")).toMatchObject({
      schemaVersion: 2,
      revision: 2,
      jobs: [],
    });
    expect(storage.values.has(SUPPORT_QUEUE_PENDING_KEY)).toBe(false);
    await expect(queue.dueEntries(Date.now())).resolves.toEqual([]);

    queue.dispose();
    const restartedBridge = snapshotBridge();
    const restarted = createController(storage, restartedBridge);
    await restarted.initialize();
    await expect(restarted.dueEntries(Date.now())).resolves.toEqual([]);
    expect(restartedBridge.reconcileArtifacts).toHaveBeenCalledWith({
      artifacts: [],
      referencedAttachmentPaths: [],
    });
    expect(cloud.createSupportReport).toHaveBeenCalledTimes(1);
    expect(restartedBridge.beginSubmission).not.toHaveBeenCalled();
  });

  it("keeps the same stable conflict generic without the persisted legacy marker", async () => {
    const storage = new MemoryStorage();
    const bridge = snapshotBridge();
    const queue = createController(storage, bridge);
    await queue.initialize();
    await expect(queue.enqueue({
      ...currentJob(CURRENT_JOB_ID),
      includeLogs: true,
    })).resolves.toBe("queued");
    const [queued] = await queue.dueEntries(Date.now());
    expect(queued?.job.includeLogs).toBeUndefined();

    cloud.createSupportReport.mockRejectedValue(stableConflict());
    const showToast = vi.fn();
    const markFailed = vi.spyOn(queue, "markFailed");
    await drainSupportReportQueue(drainInput(queue, bridge, showToast));

    expect(bridge.beginSubmission).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      "This report can no longer be sent. Start a new report from Help if you still need support.",
      undefined,
    );
    expect(showToast).not.toHaveBeenCalledWith(
      "This older report needs fresh diagnostic consent. Start a new report from Help.",
      undefined,
    );
    await expect(queue.dueEntries(Date.now())).resolves.toEqual([]);
  });
});

function createController(
  storage: MemoryStorage,
  supportSnapshot: DesktopSupportSnapshotBridge,
): PackagedSupportReportQueueController {
  return new PackagedSupportReportQueueController({
    storage,
    supportSnapshot,
    deleteAttachment: vi.fn(async () => {}),
    callbacks: {
      onCleanupError: vi.fn(),
      onControllerError: vi.fn(),
      onSnapshotUnavailable: vi.fn(),
    },
  });
}

function drainInput(
  queue: PackagedSupportReportQueueController,
  supportSnapshot: DesktopSupportSnapshotBridge,
  showToast: (message: string, type?: "error" | "info") => void,
): Parameters<typeof drainSupportReportQueue>[0] {
  return {
    queue,
    diagnostics: null,
    supportSnapshot,
    showToast,
    telemetry: {
      track: vi.fn(),
      getSupportContext: () => ({
        clientReleaseId: "proliferate-desktop@0.0.0+abcdef012345",
        telemetryRefs: {},
      }),
    },
    isActive: () => true,
    onLifecycleError: vi.fn(),
  };
}

function snapshotBridge(): DesktopSupportSnapshotBridge {
  return {
    beginPreparation: vi.fn(),
    finishPreparation: vi.fn(),
    cancelPreparation: vi.fn(),
    saveArchive: vi.fn(),
    readArtifact: vi.fn(),
    deleteArtifact: vi.fn(),
    reconcileArtifacts: vi.fn(async ({ artifacts }) =>
      artifacts.map((artifact) => ({ ...artifact, state: "verified" as const }))
    ),
    beginSubmission: vi.fn(),
    finishSubmission: vi.fn(),
  };
}

function stableConflict(): Error & { code: string; status: number } {
  return Object.assign(new Error("Wording deliberately carries no semantics."), {
    code: "support_report_upload_conflict",
    status: 400,
  });
}

function currentJob(jobId: string): SupportReportJob {
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
  };
}

function createResponse(status: "created" | "completed") {
  return {
    reportId: "report-1",
    clientJobId: LEGACY_JOB_ID,
    status,
    cloudDiagnosticsStatus: "not_applicable",
    serverCorrelation: {
      reportId: "report-1",
      requestId: "request-1",
      ownerUserId: "user-1",
      primaryOrganizationId: null,
      primaryTenantId: "user:user-1",
      tenantIds: ["user:user-1"],
      cloudWorkspaceIds: [],
      cloudTargetIds: [],
      anyharnessWorkspaceIds: [],
      sessionIds: [],
    },
  };
}
