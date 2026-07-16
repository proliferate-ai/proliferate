// Browser deployment/build configuration for the Web host. The single hosted
// deployment's API base URL is the only value the thin host needs; product
// defaults (repo selection, dev token login) now live in ProductClient.

/** Inputs the Web API base URL resolves from. Pure and host-agnostic. */
export interface WebApiBaseUrlInputs {
  /** The build-time VITE_PROLIFERATE_API_BASE_URL, if any. */
  explicit: string | undefined;
  /** True for a production build (`import.meta.env.PROD`). */
  isProd: boolean;
  /** The current browser origin, or null outside a browser. */
  origin: string | null;
}

// The local Vite development default. Local dev runs the API on :8000 and the
// Web dev server on a different port, so same-origin resolution does not apply.
const LOCAL_DEV_API_BASE_URL = "http://localhost:8000";

/** Trim a single trailing slash so callers build `${base}/path` consistently. */
function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  return trimmed.endsWith("/") ? trimmed.replace(/\/+$/, "") : trimmed;
}

/**
 * Resolve the API base URL the Web host talks to. Precedence:
 *
 * 1. An explicit `VITE_PROLIFERATE_API_BASE_URL` always wins. Managed Vercel
 *    builds bake their managed API origin this way and keep using it.
 * 2. A production browser build with no explicit value uses the current
 *    `window.location.origin`. This is the self-hosted case: Web is served from
 *    the same server image and public URL as its API, so same-origin is
 *    correct and needs no CORS configuration.
 * 3. Local Vite development (no explicit value, not a production build) keeps
 *    the existing `http://localhost:8000` default.
 *
 * This resolver reads no authentication method or provider information; it only
 * decides which origin the Cloud SDK targets.
 */
export function resolveWebApiBaseUrl({
  explicit,
  isProd,
  origin,
}: WebApiBaseUrlInputs): string {
  const explicitTrimmed = explicit?.trim();
  if (explicitTrimmed) {
    return normalizeBaseUrl(explicitTrimmed);
  }
  if (isProd && origin) {
    return normalizeBaseUrl(origin);
  }
  return LOCAL_DEV_API_BASE_URL;
}

export const webEnv = {
  apiBaseUrl: resolveWebApiBaseUrl({
    explicit: import.meta.env.VITE_PROLIFERATE_API_BASE_URL,
    isProd: import.meta.env.PROD,
    origin: typeof window !== "undefined" ? window.location.origin : null,
  }),
} as const;
