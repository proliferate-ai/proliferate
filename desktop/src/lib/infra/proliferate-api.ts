import { OFFICIAL_HOSTED_API_ORIGINS } from "@/config/capabilities";
import { getDesktopAppConfig } from "@/platform/tauri/config";

const DEFAULT_PROLIFERATE_API_BASE_URL = "http://127.0.0.1:8000";
let runtimeApiBaseUrl: string | null = null;

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/$/, "");
}

export async function bootstrapProliferateApiConfig(): Promise<void> {
  const config = await getDesktopAppConfig();
  runtimeApiBaseUrl = config.apiBaseUrl
    ? normalizeBaseUrl(config.apiBaseUrl)
    : null;
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
