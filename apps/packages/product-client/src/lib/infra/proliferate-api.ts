// Pure, product-owned deployment-URL helpers. The active deployment base URL is
// host-owned: the host resolves it (Desktop from its Tauri app config, Web from
// its configured origin) and supplies it to the product through
// `host.deployment.apiBaseUrl`. The runtime bootstrap and default-base-URL
// resolution stay host-side (`lib/infra/proliferate-api` in the Desktop host);
// these helpers take the base URL explicitly so product code never reaches a
// host deployment singleton.

import { OFFICIAL_HOSTED_API_ORIGINS } from "#product/config/capabilities";

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/$/, "");
}

export function buildProliferateApiUrl(path: string, baseUrl: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

export function getProliferateApiOrigin(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return normalizeBaseUrl(baseUrl);
  }
}

export function isOfficialHostedApiBaseUrl(baseUrl: string): boolean {
  return (OFFICIAL_HOSTED_API_ORIGINS as readonly string[]).includes(
    getProliferateApiOrigin(baseUrl),
  );
}
