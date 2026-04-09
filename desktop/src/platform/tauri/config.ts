import { invoke } from "@tauri-apps/api/core";

export interface DesktopAppConfig {
  apiBaseUrl: string | null;
}

const EMPTY_APP_CONFIG: DesktopAppConfig = {
  apiBaseUrl: null,
};

export async function getDesktopAppConfig(): Promise<DesktopAppConfig> {
  try {
    const record = await invoke<DesktopAppConfig | null>("get_app_config");
    return record ?? EMPTY_APP_CONFIG;
  } catch {
    return EMPTY_APP_CONFIG;
  }
}
