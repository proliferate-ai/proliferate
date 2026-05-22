import { invoke } from "@tauri-apps/api/core";

export interface EnsureDesktopDispatchWorkerInput {
  targetId: string;
  enrollmentToken?: string | null;
  cloudBaseUrl: string;
  anyharnessBaseUrl: string;
}

export interface EnsureDesktopDispatchWorkerResult {
  targetId: string;
  status: "running" | "started";
  configPath: string;
}

export async function ensureDesktopDispatchWorker(
  input: EnsureDesktopDispatchWorkerInput,
): Promise<EnsureDesktopDispatchWorkerResult> {
  return invoke<EnsureDesktopDispatchWorkerResult>("ensure_desktop_dispatch_worker", {
    input,
  });
}
