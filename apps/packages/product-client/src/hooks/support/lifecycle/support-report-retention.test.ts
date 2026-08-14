import { describe, expect, it, vi } from "vitest";
import type { ProductStorage } from "#product/host/product-host";
import type { SupportReportJob } from "#product/lib/domain/support/report-types";

import { createSupportQueueDocument } from "./support-report-queue-document";
import {
  createPersistedSupportReportJob,
  parsePersistedSupportReportJob,
} from "./support-report-queue-entry";
import { SUPPORT_QUEUE_LEGACY_KEY } from "./support-report-queue-migration";
import {
  commitSupportQueueMutation,
  hydrateSupportQueue,
  SUPPORT_QUEUE_PRIMARY_KEY,
} from "./support-report-queue-storage";
import {
  SUPPORT_REPORT_RETENTION_MS,
  sweepSupportReportRetention,
} from "./support-report-retention";

const NOW = Date.parse("2026-08-13T00:00:00.000Z");
const EXPIRED = new Date(NOW - SUPPORT_REPORT_RETENTION_MS - 1_000).toISOString();
const LIVE = new Date(NOW - SUPPORT_REPORT_RETENTION_MS + 60_000).toISOString();

class MemoryStorage implements ProductStorage {
  readonly values = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }
}

describe("support report retention sweep", () => {
  it("reaps a job past the window and keeps one inside it", async () => {
    const storage = await seed([
      job("expired", { createdAt: EXPIRED }),
      job("live", { createdAt: LIVE }),
    ]);

    const sweep = await sweepSupportReportRetention({ storage, now: NOW });

    expect(sweep.removedJobIds).toEqual(["expired"]);
    expect(sweep.retainedJobIds).toEqual(["live"]);
    const document = await hydrateSupportQueue(storage, parsePersistedSupportReportJob);
    expect(document.jobs.map((entry) => entry.job.jobId)).toEqual(["live"]);
  });

  it("reconciles staged bytes against the survivors only", async () => {
    const storage = await seed([
      job("expired", { createdAt: EXPIRED, attachments: [attachment("expired-path")] }),
      job("live", { createdAt: LIVE, attachments: [attachment("live-path")] }),
    ]);
    const reconcileArtifacts = vi.fn(async () => []);

    await sweepSupportReportRetention({
      storage,
      supportSnapshot: { reconcileArtifacts },
      now: NOW,
    });

    // The reaped job's staged bytes are absent from the referenced set, which
    // is what makes native delete them.
    expect(reconcileArtifacts).toHaveBeenCalledWith({
      artifacts: [],
      referencedAttachmentPaths: ["live-path"],
    });
  });

  it("reconciles orphaned bytes even when nothing expired", async () => {
    const storage = await seed([job("live", { createdAt: LIVE })]);
    const reconcileArtifacts = vi.fn(async () => []);

    const sweep = await sweepSupportReportRetention({
      storage,
      supportSnapshot: { reconcileArtifacts },
      now: NOW,
    });

    expect(sweep.removedJobIds).toEqual([]);
    expect(sweep.reconciled).toBe(true);
    expect(reconcileArtifacts).toHaveBeenCalledTimes(1);
  });

  it("drops a fully expired legacy document but keeps one holding a live job", async () => {
    const storage = new MemoryStorage();
    storage.values.set(
      SUPPORT_QUEUE_LEGACY_KEY,
      JSON.stringify([{ job: job("old", { createdAt: EXPIRED }) }]),
    );
    await expect(sweepSupportReportRetention({ storage, now: NOW }))
      .resolves.toMatchObject({ removedLegacyDocument: true });
    expect(storage.values.has(SUPPORT_QUEUE_LEGACY_KEY)).toBe(false);

    const mixed = new MemoryStorage();
    mixed.values.set(
      SUPPORT_QUEUE_LEGACY_KEY,
      JSON.stringify([
        { job: job("old", { createdAt: EXPIRED }) },
        { job: job("live", { createdAt: LIVE }) },
      ]),
    );
    await expect(sweepSupportReportRetention({ storage: mixed, now: NOW }))
      .resolves.toMatchObject({ removedLegacyDocument: false });
    expect(mixed.values.has(SUPPORT_QUEUE_LEGACY_KEY)).toBe(true);
  });

  it("never reconciles against an unhydratable document", async () => {
    const storage = new MemoryStorage();
    storage.values.set(SUPPORT_QUEUE_PRIMARY_KEY, "{not a document");
    const reconcileArtifacts = vi.fn(async () => []);

    await expect(sweepSupportReportRetention({
      storage,
      supportSnapshot: { reconcileArtifacts },
      now: NOW,
    })).rejects.toThrow();

    // Reconciling on an unknown survivor set would delete staged bytes a
    // repairable document still points at.
    expect(reconcileArtifacts).not.toHaveBeenCalled();
    expect(storage.values.get(SUPPORT_QUEUE_PRIMARY_KEY)).toBe("{not a document");
  });
});

async function seed(jobs: SupportReportJob[]): Promise<MemoryStorage> {
  const storage = new MemoryStorage();
  await commitSupportQueueMutation(
    storage,
    await createSupportQueueDocument<ReturnType<typeof createPersistedSupportReportJob>>(0, []),
    jobs.map((entry) => createPersistedSupportReportJob(entry)),
    parsePersistedSupportReportJob,
  );
  return storage;
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
