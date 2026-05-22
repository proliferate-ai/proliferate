const DEFAULT_PROLIFERATE_WEB_BASE_URL = "https://app.proliferate.ai";

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/u, "");
}

export function getProliferateWebBaseUrl(): string {
  const raw = import.meta.env.VITE_PROLIFERATE_WEB_BASE_URL?.trim()
    || DEFAULT_PROLIFERATE_WEB_BASE_URL;
  return normalizeBaseUrl(raw);
}

