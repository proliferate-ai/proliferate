import { invoke } from "@tauri-apps/api/core";

/**
 * This machine's hostname via the os plugin command (registered in lib.rs,
 * `os:default` capability). Null outside Tauri or when the plugin errors.
 */
export async function getOsHostname(): Promise<string | null> {
  try {
    return await invoke<string | null>("plugin:os|hostname");
  } catch {
    return null;
  }
}
