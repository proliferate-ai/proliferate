import { describe, expect, it } from "vitest";
import { createMemoryProductStorage } from "@/test/product-storage-test-utils";
import type { SupportReportJob } from "@/lib/domain/support/report-types";
import {
  persistSupportReportJob,
  readPersistedJobs,
  removePersistedJob,
} from "./support-report-upload-persistence";

const STORAGE_KEY = "proliferate.supportReportJobs.v1";

function job(jobId: string): SupportReportJob {
  return { jobId, attachments: [], createdAt: new Date(0).toISOString() } as unknown as SupportReportJob;
}

describe("support report upload persistence", () => {
  it("queues a new job once and dedupes repeats", async () => {
    const memory = createMemoryProductStorage();

    expect(await persistSupportReportJob(memory.context, job("a"))).toBe(true);
    expect(await persistSupportReportJob(memory.context, job("a"))).toBe(false);

    const stored = await readPersistedJobs(memory.context);
    expect(stored.map((entry) => entry.job.jobId)).toEqual(["a"]);
  });

  it("removes a queued job", async () => {
    const memory = createMemoryProductStorage();
    await persistSupportReportJob(memory.context, job("a"));
    await persistSupportReportJob(memory.context, job("b"));

    await removePersistedJob(memory.context, "a");

    expect((await readPersistedJobs(memory.context)).map((entry) => entry.job.jobId)).toEqual(["b"]);
  });

  it("caps persisted jobs at the last ten entries", async () => {
    const memory = createMemoryProductStorage();
    for (let index = 0; index < 12; index += 1) {
      await persistSupportReportJob(memory.context, job(`job-${index}`));
    }

    const stored = memory.readJson<{ job: { jobId: string } }[]>(STORAGE_KEY) ?? [];
    expect(stored).toHaveLength(10);
    expect(stored[0]?.job.jobId).toBe("job-2");
    expect(stored[9]?.job.jobId).toBe("job-11");
  });

  it("returns an empty list when the read rejects", async () => {
    const captured: unknown[] = [];
    const jobs = await readPersistedJobs({
      storage: {
        getItem: async () => {
          throw new Error("read failed");
        },
        setItem: async () => {},
        removeItem: async () => {},
      },
      captureException: (error) => captured.push(error),
    });
    expect(jobs).toEqual([]);
    expect(captured.length).toBe(1);
  });
});
