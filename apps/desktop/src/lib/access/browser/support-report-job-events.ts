import type { SupportReportJob } from "@/lib/domain/support/report-types";

export const SUPPORT_REPORT_JOB_EVENT = "support://report-job";

export function enqueueSupportReportJob(job: SupportReportJob): void {
  window.dispatchEvent(new CustomEvent(SUPPORT_REPORT_JOB_EVENT, { detail: job }));
}

export function listenSupportReportJobs(
  handler: (job: SupportReportJob) => void,
): Promise<() => void> {
  const listener = (event: Event) => {
    handler((event as CustomEvent<SupportReportJob>).detail);
  };
  window.addEventListener(SUPPORT_REPORT_JOB_EVENT, listener);
  return Promise.resolve(() => {
    window.removeEventListener(SUPPORT_REPORT_JOB_EVENT, listener);
  });
}
