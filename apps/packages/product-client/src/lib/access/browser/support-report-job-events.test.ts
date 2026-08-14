/* @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import type { SupportReportJob } from "#product/lib/domain/support/report-types";

import {
  enqueueSupportReportJob,
  listenSupportReportJobs,
} from "./support-report-job-events";

describe("support report enqueue request/reply", () => {
  it("fails closed when no queue owner is mounted", async () => {
    await expect(enqueueSupportReportJob(job("unclaimed"))).resolves.toBe("failed");
  });

  it("returns one exact acknowledgement from the mounted owner", async () => {
    const unlisten = await listenSupportReportJobs(async (received, requestId) => {
      expect(received.jobId).toBe("queued");
      expect(requestId).toMatch(/^queue:/);
      expect(new TextEncoder().encode(requestId).byteLength).toBeLessThanOrEqual(64);
      return "queued";
    });
    await expect(enqueueSupportReportJob(job("queued"))).resolves.toBe("queued");
    unlisten();
  });

  it("resolves a pending request as failed when its listener unmounts", async () => {
    let release: (() => void) | null = null;
    const unlisten = await listenSupportReportJobs(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return "queued";
    });
    const pending = enqueueSupportReportJob(job("pending"));
    unlisten();
    await expect(pending).resolves.toBe("failed");
    release?.();
    await Promise.resolve();
  });

  it("converts a queue-handler rejection into one failed reply", async () => {
    const unlisten = await listenSupportReportJobs(async () => {
      throw new Error("write failed");
    });
    await expect(enqueueSupportReportJob(job("rejected"))).resolves.toBe("failed");
    unlisten();
  });
});

function job(jobId: string): SupportReportJob {
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
