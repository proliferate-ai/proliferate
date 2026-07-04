import { invoke } from "@tauri-apps/api/core";
import { isTauriDesktop } from "@/lib/access/tauri/diagnostics";
import type {
  SupportReportJob,
} from "@/lib/domain/support/report-types";

export const SUPPORT_REPORT_JOB_EVENT = "support://report-job";

export async function stageSupportReportAttachment(input: {
  clientFileId: string;
  fileName: string;
  dataBase64: string;
}): Promise<string | null> {
  if (!isTauriDesktop()) {
    return null;
  }

  const result = await invoke<{ path: string }>("stage_support_report_attachment", {
    input,
  });
  return result.path;
}

export async function readStagedSupportReportAttachment(path: string): Promise<string> {
  if (!isTauriDesktop()) {
    throw new Error("Staged attachments are only available in the desktop app.");
  }

  const result = await invoke<{ dataBase64: string }>(
    "read_staged_support_report_attachment",
    { input: { path } },
  );
  return result.dataBase64;
}

export async function deleteStagedSupportReportAttachment(path: string): Promise<void> {
  if (!isTauriDesktop()) {
    return;
  }

  await invoke("delete_staged_support_report_attachment", { input: { path } });
}

/**
 * Listen for support report jobs enqueued in-process via DOM CustomEvent.
 * The modal dispatches these directly — no Tauri event relay needed.
 */
export function listenSupportReportJobs(
  handler: (job: SupportReportJob) => void,
): Promise<() => void> {
  const listener = (event: Event) => {
    handler((event as CustomEvent<SupportReportJob>).detail);
  };
  window.addEventListener(SUPPORT_REPORT_JOB_EVENT, listener);
  return Promise.resolve(() => window.removeEventListener(SUPPORT_REPORT_JOB_EVENT, listener));
}
