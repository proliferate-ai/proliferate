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
import type { DesktopSsoSignInOptions } from "@proliferate/product-client/internal/lib/domain/auth/sign-in-options"

// The SSO sign-in option shape is product-owned; the host retains only the
// secret PKCE start transport below and re-exports the type for its callers.
export type { DesktopSsoSignInOptions }

interface StartAuthResponse {
  authorizationUrl?: string | null
}

function buildUrl(path: string, baseUrl?: string): string {
  return buildAuthUrl(path, baseUrl)
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
