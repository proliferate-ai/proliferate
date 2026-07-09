import { invoke } from "@tauri-apps/api/core";

export interface DesktopAppConfig {
  apiBaseUrl: string | null;
  telemetryDisabled: boolean;
  nativeDevProfile: boolean;
}

const EMPTY_APP_CONFIG: DesktopAppConfig = {
  apiBaseUrl: null,
  telemetryDisabled: false,
  nativeDevProfile: false,
};

export async function getDesktopAppConfig(): Promise<DesktopAppConfig> {
  try {
    return await invoke<DesktopAppConfig>("get_app_config");
  } catch {
    return EMPTY_APP_CONFIG;
  }
}

export interface SetDesktopAppConfigInput {
  /** New server base URL, or `null` to reset to the packaged default. */
  apiBaseUrl: string | null;
}

/**
 * Connect-to-server write path (self-hosting-v1 §3.5): rewrites `apiBaseUrl`
 * in config.json. Read-once at startup — callers must relaunch the app for
 * the value to take effect. Outside Tauri (the plain web build) `invoke`
 * throws; that propagates so callers can surface it, but the connect
 * affordance itself must never be reachable there (gated on
 * `isTauriDockApiAvailable`-style runtime checks at the call site).
 */
export async function setDesktopAppConfig(
  input: SetDesktopAppConfigInput,
): Promise<DesktopAppConfig> {
  return await invoke<DesktopAppConfig>("set_app_config", { input });
}
