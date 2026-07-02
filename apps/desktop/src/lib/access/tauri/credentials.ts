import { invoke } from "@tauri-apps/api/core";
import type { RuntimeInfo } from "./runtime";

export async function listConfiguredEnvVarNames(): Promise<string[]> {
  return invoke<string[]>("list_configured_env_var_names");
}

export async function setEnvVarSecret(
  name: string,
  value: string,
): Promise<void> {
  return invoke("set_env_var_secret", { name, value });
}

export async function deleteEnvVarSecret(name: string): Promise<void> {
  return invoke("delete_env_var_secret", { name });
}

export async function restartRuntime(): Promise<RuntimeInfo> {
  return invoke<RuntimeInfo>("restart_runtime");
}
