import type { SupportReportJob } from "#product/lib/domain/support/report-types";

export const SUPPORT_REPORT_JOB_EVENT = "support://report-job";
const MAX_REQUEST_ID_BYTES = 64;
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type SupportReportEnqueueResult =
  | "conflict"
  | "duplicate"
  | "failed"
  | "full"
  | "queued";

interface SupportReportJobRequest {
  requestId: string;
  job: SupportReportJob;
  claim(): ((result: SupportReportEnqueueResult) => void) | null;
}

/**
 * Dispatch one bounded request/reply enqueue operation.
 *
 * A missing listener resolves `failed` in the same turn. The first mounted
 * queue listener claims the request synchronously; its unlisten path resolves
 * every still-pending request as `failed`. The reply closure itself is
 * idempotent, so replacement, late writes, and duplicate listeners cannot
 * produce a second result or turn a failed request into success.
 */
export function enqueueSupportReportJob(
  job: SupportReportJob,
): Promise<SupportReportEnqueueResult> {
  return new Promise((resolve) => {
    let claimed = false;
    let settled = false;
    const settle = (result: SupportReportEnqueueResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let requestId: string;
    try {
      const randomId = crypto.randomUUID();
      if (!CANONICAL_UUID.test(randomId)) {
        settle("failed");
        return;
      }
      requestId = `queue:${randomId}`;
    } catch {
      settle("failed");
      return;
    }
    // The fixed prefix and randomUUID output are ASCII, so code-unit length is
    // the exact UTF-8 byte length without another fallible platform API.
    if (requestId.length > MAX_REQUEST_ID_BYTES) {
      settle("failed");
      return;
    }

    const detail: SupportReportJobRequest = {
      requestId,
      job,
      claim() {
        if (claimed) return null;
        claimed = true;
        return settle;
      },
    };
    try {
      window.dispatchEvent(new CustomEvent(SUPPORT_REPORT_JOB_EVENT, { detail }));
    } catch {
      settle("failed");
      return;
    }
    if (!claimed) settle("failed");
  });
}

export function listenSupportReportJobs(
  handler: (
    job: SupportReportJob,
    requestId: string,
  ) => Promise<SupportReportEnqueueResult> | SupportReportEnqueueResult,
): Promise<() => void> {
  const pending = new Set<(result: SupportReportEnqueueResult) => void>();
  let active = true;
  const listener = (event: Event) => {
    const request = (event as CustomEvent<SupportReportJobRequest>).detail;
    const reply = request?.claim?.();
    if (!reply) return;
    if (!active) {
      reply("failed");
      return;
    }
    pending.add(reply);
    let result: Promise<SupportReportEnqueueResult>;
    try {
      result = Promise.resolve(handler(request.job, request.requestId));
    } catch {
      result = Promise.resolve("failed");
    }
    void result.then(
      (ack) => {
        pending.delete(reply);
        reply(active && isEnqueueResult(ack) ? ack : "failed");
      },
      () => {
        pending.delete(reply);
        reply("failed");
      },
    );
  };
  window.addEventListener(SUPPORT_REPORT_JOB_EVENT, listener);
  return Promise.resolve(() => {
    if (!active) return;
    active = false;
    try {
      window.removeEventListener(SUPPORT_REPORT_JOB_EVENT, listener);
    } finally {
      for (const reply of pending) reply("failed");
      pending.clear();
    }
  });
}

function isEnqueueResult(value: unknown): value is SupportReportEnqueueResult {
  return value === "queued"
    || value === "duplicate"
    || value === "full"
    || value === "conflict"
    || value === "failed";
}
