import { invoke } from "@tauri-apps/api/core";

export interface RuntimeInfo {
  url: string;
  port: number;
  status: "starting" | "healthy" | "failed" | "stopped";
}

export async function getRuntimeInfo(): Promise<RuntimeInfo> {
  return invoke<RuntimeInfo>("get_runtime_info");
}
