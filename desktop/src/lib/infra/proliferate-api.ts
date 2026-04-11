import { OFFICIAL_HOSTED_API_ORIGINS } from "@/config/capabilities";
import {
  type DesktopAppConfig,
  getDesktopAppConfig,
} from "@/platform/tauri/config";

const DEFAULT_PROLIFERATE_API_BASE_URL = "http://127.0.0.1:8000";
const DEFAULT_DESKTOP_APP_CONFIG: DesktopAppConfig = {
  apiBaseUrl: null,
  telemetryDisabled: false,
  nativeDevProfile: false,
};
let runtimeApiBaseUrl: string | null = null;
let runtimeAppConfig: DesktopAppConfig = DEFAULT_DESKTOP_APP_CONFIG;

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/$/, "");
}

export async function bootstrapProliferateApiConfig(): Promise<void> {
  runtimeAppConfig = await getDesktopAppConfig();
  runtimeApiBaseUrl = runtimeAppConfig.apiBaseUrl
    ? normalizeBaseUrl(runtimeAppConfig.apiBaseUrl)
    : null;
}

export function getRuntimeDesktopAppConfig(): DesktopAppConfig {
  return runtimeAppConfig;
}

export function getProliferateApiBaseUrl(): string {
  const raw = runtimeApiBaseUrl
    ?? import.meta.env.VITE_PROLIFERATE_API_BASE_URL?.trim()
    ?? DEFAULT_PROLIFERATE_API_BASE_URL;

  return normalizeBaseUrl(raw);
}

export function buildProliferateApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getProliferateApiBaseUrl()}${normalizedPath}`;
}

export function getProliferateApiOrigin(
  baseUrl = getProliferateApiBaseUrl(),
): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return normalizeBaseUrl(baseUrl);
  }
}

export function isOfficialHostedApiBaseUrl(
  baseUrl = getProliferateApiBaseUrl(),
): boolean {
  return (OFFICIAL_HOSTED_API_ORIGINS as readonly string[]).includes(
    getProliferateApiOrigin(baseUrl),
  );
}
