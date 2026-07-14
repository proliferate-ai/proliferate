import { invoke } from "@tauri-apps/api/core";
import { isTauriDesktop } from "@/lib/access/tauri/diagnostics";

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
