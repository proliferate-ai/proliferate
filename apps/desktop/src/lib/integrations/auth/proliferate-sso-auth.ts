import { openAuthSessionUrl } from "@/lib/access/tauri/auth"
import {
  DESKTOP_AUTH_REDIRECT_URI,
  sha256Base64Url,
} from "./proliferate-auth-redirect"
import {
  AuthRequestError,
  buildAuthUrl,
  fetchAuthResponse,
  parseAuthError,
} from "./proliferate-auth-transport"

interface StartAuthResponse {
  authorizationUrl?: string | null
}

interface SsoDiscoveryResponse {
  enabled: boolean
  scope?: "deployment" | "organization" | null
  connectionId?: string | null
  organizationId?: string | null
  protocol?: "oidc" | "saml" | null
  displayName?: string | null
  reason?: string | null
}

export interface DesktopSsoDiscovery {
  enabled: boolean
  scope: "deployment" | "organization" | null
  connectionId: string | null
  organizationId: string | null
  protocol: "oidc" | "saml" | null
  displayName: string | null
  reason: string | null
}

export interface DesktopSsoSignInOptions {
  email?: string | null
  organizationId?: string | null
  connectionId?: string | null
  prompt?: "select_account"
}

function buildUrl(path: string): string {
  return buildAuthUrl(path)
}

export async function discoverDesktopSso(
  options: Pick<DesktopSsoSignInOptions, "email" | "organizationId" | "connectionId"> = {},
): Promise<DesktopSsoDiscovery> {
  const params = new URLSearchParams()
  if (options.email) params.set("email", options.email)
  if (options.organizationId) params.set("organizationId", options.organizationId)
  if (options.connectionId) params.set("connectionId", options.connectionId)
  const query = params.toString()
  const response = await fetchAuthResponse(
    buildUrl(`/auth/sso/discover${query ? `?${query}` : ""}`),
    {
      headers: {
        Accept: "application/json",
      },
    },
  )

  if (!response.ok) {
    throw await parseAuthError(response)
  }

  const payload = (await response.json()) as SsoDiscoveryResponse
  return {
    enabled: payload.enabled,
    scope: payload.scope ?? null,
    connectionId: payload.connectionId ?? null,
    organizationId: payload.organizationId ?? null,
    protocol: payload.protocol ?? null,
    displayName: payload.displayName ?? null,
    reason: payload.reason ?? null,
  }
}

export async function beginDesktopSsoSignIn(
  state: string,
  codeVerifier: string,
  redirectUri = DESKTOP_AUTH_REDIRECT_URI,
  options?: DesktopSsoSignInOptions,
): Promise<void> {
  const codeChallenge = await sha256Base64Url(codeVerifier)
  const response = await fetchAuthResponse(buildUrl("/auth/desktop/sso/start"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      clientState: state,
      codeChallenge,
      codeChallengeMethod: "S256",
      redirectUri,
      email: options?.email?.trim() || undefined,
      organizationId: options?.organizationId || undefined,
      connectionId: options?.connectionId || undefined,
      prompt: options?.prompt,
    }),
  })

  if (!response.ok) {
    throw await parseAuthError(response)
  }

  const payload = (await response.json()) as StartAuthResponse
  if (!payload.authorizationUrl) {
    throw new AuthRequestError("SSO did not return an authorization URL.", 503)
  }

  await openAuthSessionUrl(payload.authorizationUrl)
}
