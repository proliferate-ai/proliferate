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
