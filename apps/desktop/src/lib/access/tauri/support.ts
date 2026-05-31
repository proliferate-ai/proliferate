import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauriDesktop } from "@/lib/access/tauri/diagnostics";
import type {
  SupportReportJob,
  SupportReportWindowSnapshot,
} from "@/lib/domain/support/report-types";

export const SUPPORT_REPORT_JOB_EVENT = "support://report-job";
export const SUPPORT_SNAPSHOT_UPDATED_EVENT = "support://snapshot-updated";

export async function openSupportReportWindow(
  snapshot: SupportReportWindowSnapshot,
): Promise<void> {
  if (!isTauriDesktop()) {
    window.dispatchEvent(new CustomEvent(SUPPORT_SNAPSHOT_UPDATED_EVENT, { detail: snapshot }));
    return;
  }

  await invoke("open_support_report_window", { input: { snapshot } });
}

export async function closeSupportReportWindow(): Promise<void> {
  if (!isTauriDesktop()) {
    return;
  }

  await invoke("close_support_report_window");
}

export async function getSupportReportWindowSnapshot(): Promise<SupportReportWindowSnapshot | null> {
  if (!isTauriDesktop()) {
    return null;
  }

  return invoke<SupportReportWindowSnapshot | null>("get_support_report_window_snapshot");
}

export async function submitSupportReportJob(job: SupportReportJob): Promise<void> {
  if (!isTauriDesktop()) {
    window.dispatchEvent(new CustomEvent(SUPPORT_REPORT_JOB_EVENT, { detail: job }));
    return;
  }

  await invoke("submit_support_report_job", { input: job });
}

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

export async function listenSupportReportJobs(
  handler: (job: SupportReportJob) => void,
): Promise<UnlistenFn> {
  if (!isTauriDesktop()) {
    const listener = (event: Event) => {
      handler((event as CustomEvent<SupportReportJob>).detail);
    };
    window.addEventListener(SUPPORT_REPORT_JOB_EVENT, listener);
    return () => window.removeEventListener(SUPPORT_REPORT_JOB_EVENT, listener);
  }

  return listen<SupportReportJob>(SUPPORT_REPORT_JOB_EVENT, (event) => handler(event.payload));
}

export async function listenSupportSnapshotUpdates(
  handler: (snapshot: SupportReportWindowSnapshot) => void,
): Promise<UnlistenFn> {
  if (!isTauriDesktop()) {
    const listener = (event: Event) => {
      handler((event as CustomEvent<SupportReportWindowSnapshot>).detail);
    };
    window.addEventListener(SUPPORT_SNAPSHOT_UPDATED_EVENT, listener);
    return () => window.removeEventListener(SUPPORT_SNAPSHOT_UPDATED_EVENT, listener);
  }

  return listen<SupportReportWindowSnapshot>(
    SUPPORT_SNAPSHOT_UPDATED_EVENT,
    (event) => handler(event.payload),
  );
}
