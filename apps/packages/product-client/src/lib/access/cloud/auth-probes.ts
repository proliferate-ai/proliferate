// Public, unauthenticated server capability probes. Promoted out of the retained
// Desktop host `lib/integrations/auth/*` into product-owned cloud access per the
// owner ruling: these are plain HTTP GETs that read what a connected deployment
// supports (password login, GitHub OAuth availability, SSO discovery). They
// carry no PKCE verifier, token, session, or user record — the secret OAuth /
// PKCE transport stays host-side. Callers pass the deployment base URL
// explicitly (the product host supplies `host.deployment.apiBaseUrl`), so these
// need no host deployment-config default; the shared error/fetch primitives come
// from `./auth-transport` (one class, identity-stable across the host boundary).

import {
  elapsedStartupMs,
  logStartupDebug,
  startStartupTimer,
  summarizeStartupError,
} from "#product/lib/infra/measurement/measurement-port";

import { fetchAuthResponse, parseAuthError } from "#product/lib/access/cloud/auth-transport";

function buildUrl(path: string, baseUrl: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

// --- Auth methods -----------------------------------------------------------

interface AuthMethodsResponse {
  password_login: boolean;
  github: boolean;
}

export interface DesktopAuthMethods {
  passwordLogin: boolean;
  github: boolean;
}

export async function getDesktopAuthMethods(
  apiBaseUrl: string,
): Promise<DesktopAuthMethods> {
  const response = await fetchAuthResponse(
    buildUrl("/auth/desktop/methods", apiBaseUrl),
    {
      headers: {
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    throw await parseAuthError(response);
  }

  const payload = (await response.json()) as AuthMethodsResponse;
  return {
    passwordLogin: payload.password_login === true,
    github: payload.github === true,
  };
}

// --- GitHub OAuth availability ----------------------------------------------

interface OAuthAvailabilityResponse {
  enabled: boolean;
  client_id?: string | null;
}

export interface GitHubDesktopAuthAvailability {
  enabled: boolean;
  clientId: string | null;
}

export async function getGitHubDesktopAuthAvailability(
  apiBaseUrl: string,
): Promise<GitHubDesktopAuthAvailability> {
  const startedAt = startStartupTimer();
  logStartupDebug("auth.github_desktop_availability.start");

  try {
    const response = await fetchAuthResponse(
      buildUrl("/auth/desktop/github/availability", apiBaseUrl),
      {
        headers: {
          Accept: "application/json",
        },
      },
    );

    if (!response.ok) {
      logStartupDebug("auth.github_desktop_availability.failed", {
        elapsedMs: elapsedStartupMs(startedAt),
        status: response.status,
      });
      throw await parseAuthError(response);
    }

    const payload = (await response.json()) as OAuthAvailabilityResponse;
    const availability = {
      enabled: payload.enabled,
      clientId: payload.client_id ?? null,
    } satisfies GitHubDesktopAuthAvailability;
    logStartupDebug("auth.github_desktop_availability.completed", {
      elapsedMs: elapsedStartupMs(startedAt),
      enabled: availability.enabled,
      hasClientId: availability.clientId !== null,
    });
    return availability;
  } catch (error) {
    logStartupDebug("auth.github_desktop_availability.failed", {
      elapsedMs: elapsedStartupMs(startedAt),
      ...summarizeStartupError(error),
    });
    throw error;
  }
}

// --- SSO discovery ----------------------------------------------------------

interface SsoDiscoveryResponse {
  enabled: boolean;
  scope?: "deployment" | "organization" | null;
  connectionId?: string | null;
  organizationId?: string | null;
  protocol?: "oidc" | "saml" | null;
  displayName?: string | null;
  reason?: string | null;
}

export interface DesktopSsoDiscovery {
  enabled: boolean;
  scope: "deployment" | "organization" | null;
  connectionId: string | null;
  organizationId: string | null;
  protocol: "oidc" | "saml" | null;
  displayName: string | null;
  reason: string | null;
}

export interface DiscoverDesktopSsoOptions {
  apiBaseUrl: string;
  email?: string | null;
  organizationId?: string | null;
  connectionId?: string | null;
  slug?: string | null;
}

export async function discoverDesktopSso(
  options: DiscoverDesktopSsoOptions,
): Promise<DesktopSsoDiscovery> {
  const params = new URLSearchParams();
  if (options.email) params.set("email", options.email);
  if (options.organizationId) params.set("organizationId", options.organizationId);
  if (options.connectionId) params.set("connectionId", options.connectionId);
  if (options.slug) params.set("slug", options.slug);
  const query = params.toString();
  const response = await fetchAuthResponse(
    buildUrl(`/auth/sso/discover${query ? `?${query}` : ""}`, options.apiBaseUrl),
    {
      headers: {
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    throw await parseAuthError(response);
  }

  const payload = (await response.json()) as SsoDiscoveryResponse;
  return {
    enabled: payload.enabled,
    scope: payload.scope ?? null,
    connectionId: payload.connectionId ?? null,
    organizationId: payload.organizationId ?? null,
    protocol: payload.protocol ?? null,
    displayName: payload.displayName ?? null,
    reason: payload.reason ?? null,
  };
}

// --- GitHub OAuth app settings link -----------------------------------------

const GITHUB_APP_SETTINGS_FALLBACK_URL = "https://github.com/settings/applications";

// The settings URL a user follows to review/adjust the GitHub OAuth app that the
// availability probe reports (`clientId`). Product-owned display helper; relocated
// from the retained host auth transport with the availability probe.
export function buildGitHubOAuthAppSettingsUrl(clientId?: string | null): string {
  if (!clientId) {
    return GITHUB_APP_SETTINGS_FALLBACK_URL;
  }
  return `https://github.com/settings/connections/applications/${encodeURIComponent(clientId)}`;
}
