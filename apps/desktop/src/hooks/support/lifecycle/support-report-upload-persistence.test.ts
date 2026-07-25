import { describe, expect, it, vi } from "vitest";
import type { ProductStorage } from "@proliferate/product-client/host/product-host";

import type { SupportReportJob } from "@/lib/domain/support/report-types";
import type { ProductStorageContext } from "@/lib/infra/persistence/product-storage";
import {
  markPersistedJobFailed,
  persistSupportReportJob,
  readPersistedJobs,
  removePersistedJob,
} from "./support-report-upload-persistence";

const STORAGE_KEY = "proliferate.supportReportJobs.v1";

describe("support report upload persistence", () => {
  it("persists one job and ignores a duplicate", async () => {
    const harness = createStorageHarness();
    const job = makeJob("job-1");

    await expect(persistSupportReportJob(harness.context, job)).resolves.toBe(true);
    await expect(persistSupportReportJob(harness.context, job)).resolves.toBe(false);

    await expect(readPersistedJobs(harness.context)).resolves.toEqual([
      {
        job,
        attemptCount: 0,
        nextAttemptAt: null,
        lastError: null,
      },
    ]);
    expect(harness.setItem).toHaveBeenCalledOnce();
  });

  it("marks a failed job and then removes it", async () => {
    const harness = createStorageHarness([makePersistedJob("job-1")]);
    const failedAt = new Date("2026-07-14T12:00:00.000Z");

    await markPersistedJobFailed(
      harness.context,
      "job-1",
      {
        kind: "transient",
        message: "network unavailable",
        retryable: true,
        retryDelayMs: 30_000,
        toastMessage: "Retrying",
        toastCooldownMs: 30_000,
      },
      failedAt,
      true,
    );

    await expect(readPersistedJobs(harness.context)).resolves.toMatchObject([
      {
        attemptCount: 1,
        lastError: "network unavailable",
        lastFailureKind: "transient",
        lastFailureToastAt: failedAt.toISOString(),
        lastFailureToastKind: "transient",
        nextAttemptAt: "2026-07-14T12:00:30.000Z",
      },
    ]);

    await removePersistedJob(harness.context, "job-1");
    await expect(readPersistedJobs(harness.context)).resolves.toEqual([]);
  });
});

function createStorageHarness(initialJobs: unknown[] = []) {
  const values = new Map<string, string>();
  if (initialJobs.length > 0) {
    values.set(STORAGE_KEY, JSON.stringify(initialJobs));
  }
  const getItem = vi.fn(async (key: string) => values.get(key) ?? null);
  const setItem = vi.fn(async (key: string, value: string) => {
    values.set(key, value);
  });
  const storage: ProductStorage = {
    getItem,
    setItem,
    removeItem: vi.fn(async (key) => {
      values.delete(key);
    }),
  };
  const context: ProductStorageContext = {
    storage,
    captureException: vi.fn(),
  };
  return { context, setItem };
}

function makePersistedJob(jobId: string) {
  return {
    job: makeJob(jobId),
    attemptCount: 0,
    nextAttemptAt: null,
    lastError: null,
  };
}

function makeJob(jobId: string): SupportReportJob {
  return {
    jobId,
    createdAt: "2026-07-14T12:00:00.000Z",
    message: "Help",
    scope: { kind: "app_only", workspaceIds: [] },
    publicContentConsent: false,
    kind: "bug",
    creditConsent: false,
    snapshot: {
      openedAt: "2026-07-14T12:00:00.000Z",
      source: "sidebar",
      context: { source: "sidebar", intent: "general" },
      defaultScope: "app_only",
      defaultWorkspaceId: null,
      workspaceOptions: [],
    },
    attachments: [],
  };
}
