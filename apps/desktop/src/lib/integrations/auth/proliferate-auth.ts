import {
  openAuthSessionUrl,
  type StoredAuthSession,
} from "@/lib/access/tauri/auth"
import {
  elapsedStartupMs,
  logStartupDebug,
  startStartupTimer,
  summarizeStartupError,
} from "@/lib/infra/measurement/debug-startup"
import type { AuthUser } from "@/lib/domain/auth/auth-user"
import {
  abortError,
  AuthRequestError,
  buildAuthUrl,
  delay,
  fetchAuthResponse,
  isAbortError,
  isDefinitiveAuthRejection,
  parseAuthError,
} from "./proliferate-auth-transport"
import {
  createPendingGitHubDesktopAuth,
  DESKTOP_AUTH_REDIRECT_URI,
  isPendingDesktopAuthExpired,
  PENDING_AUTH_MAX_AGE_MS,
  parseDesktopAuthCallback,
  sha256Base64Url,
  type DesktopAuthCallback,
} from "./proliferate-auth-redirect"

export type { AuthUser }
export {
  abortError,
  AuthRequestError,
  isDefinitiveAuthRejection,
  isAbortError,
  createPendingGitHubDesktopAuth,
  DESKTOP_AUTH_REDIRECT_URI,
  isPendingDesktopAuthExpired,
  PENDING_AUTH_MAX_AGE_MS,
  parseDesktopAuthCallback,
}
export type { DesktopAuthCallback }

interface DesktopTokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  user: {
    id: string
    email: string
    display_name: string | null
    github_login?: string | null
    avatar_url?: string | null
  }
}

interface OAuthAvailabilityResponse {
  enabled: boolean
  client_id?: string | null
}

interface StartAuthResponse {
  authorizationUrl?: string | null
}

export interface GitHubDesktopAuthAvailability {
  enabled: boolean
  clientId: string | null
}

export interface GitHubDesktopSignInOptions {
  prompt?: "select_account"
}

export interface DesktopSessionPollOptions {
  signal?: AbortSignal
  transientFailureMessage?: string
  timeoutMessage?: string
}

export type DesktopIdentityProvider = "github" | "google" | "apple"

export interface DesktopProviderAuthOptions {
  purpose?: "login" | "link" | "required_github_link"
  prompt?: "select_account"
  accessToken?: string | null
}

const GITHUB_RECOVERY_TIMEOUT_MS = 2 * 60 * 1000
const GITHUB_APP_SETTINGS_FALLBACK_URL = "https://github.com/settings/applications"

function buildUrl(path: string): string {
  return buildAuthUrl(path)
}

function toStoredSession(response: DesktopTokenResponse): StoredAuthSession {
  const expiresAt = new Date(Date.now() + response.expires_in * 1000).toISOString()
  return {
    access_token: response.access_token,
    refresh_token: response.refresh_token,
    expires_at: expiresAt,
    user_id: response.user.id,
    email: response.user.email,
    display_name: response.user.display_name,
    github_login: response.user.github_login ?? null,
    avatar_url: response.user.avatar_url ?? null,
  }
}


export function isSessionExpiring(session: StoredAuthSession, skewSeconds = 60): boolean {
  const expiresAt = Date.parse(session.expires_at)
  if (Number.isNaN(expiresAt)) return true
  return expiresAt - Date.now() <= skewSeconds * 1000
}

export function buildGitHubOAuthAppSettingsUrl(clientId?: string | null): string {
  if (!clientId) {
    return GITHUB_APP_SETTINGS_FALLBACK_URL
  }
  return `https://github.com/settings/connections/applications/${encodeURIComponent(clientId)}`
}

export async function getGitHubDesktopAuthAvailability(): Promise<GitHubDesktopAuthAvailability> {
  const startedAt = startStartupTimer()
  logStartupDebug("auth.github_desktop_availability.start")

  try {
    const response = await fetchAuthResponse(buildUrl("/auth/desktop/github/availability"), {
      headers: {
        Accept: "application/json",
      },
    })

    if (!response.ok) {
      logStartupDebug("auth.github_desktop_availability.failed", {
        elapsedMs: elapsedStartupMs(startedAt),
        status: response.status,
      })
      throw await parseAuthError(response)
    }

    const payload = (await response.json()) as OAuthAvailabilityResponse
    const availability = {
      enabled: payload.enabled,
      clientId: payload.client_id ?? null,
    } satisfies GitHubDesktopAuthAvailability
    logStartupDebug("auth.github_desktop_availability.completed", {
      elapsedMs: elapsedStartupMs(startedAt),
      enabled: availability.enabled,
      hasClientId: availability.clientId !== null,
    })
    return availability
  } catch (error) {
    logStartupDebug("auth.github_desktop_availability.failed", {
      elapsedMs: elapsedStartupMs(startedAt),
      ...summarizeStartupError(error),
    })
    throw error
  }
}

export async function isGitHubDesktopAuthAvailable(): Promise<boolean> {
  const availability = await getGitHubDesktopAuthAvailability()
  return availability.enabled
}

export async function beginGitHubDesktopSignIn(
  state: string,
  codeVerifier: string,
  redirectUri = DESKTOP_AUTH_REDIRECT_URI,
  options?: GitHubDesktopSignInOptions,
): Promise<void> {
  await beginDesktopProviderAuth("github", state, codeVerifier, redirectUri, {
    purpose: "login",
    prompt: options?.prompt,
  })
}

export async function beginDesktopProviderAuth(
  provider: DesktopIdentityProvider,
  state: string,
  codeVerifier: string,
  redirectUri = DESKTOP_AUTH_REDIRECT_URI,
  options?: DesktopProviderAuthOptions,
): Promise<void> {
  const codeChallenge = await sha256Base64Url(codeVerifier)
  const headers = new Headers({
    "Content-Type": "application/json",
    Accept: "application/json",
  })
  if (options?.accessToken) {
    headers.set("Authorization", `Bearer ${options.accessToken}`)
  }
  const response = await fetchAuthResponse(buildUrl(`/auth/desktop/${provider}/start`), {
    method: "POST",
    headers,
    body: JSON.stringify({
      purpose: options?.purpose ?? "login",
      clientState: state,
      codeChallenge,
      codeChallengeMethod: "S256",
      redirectUri,
      prompt: options?.prompt,
    }),
  })

  if (!response.ok) {
    throw await parseAuthError(response)
  }

  const payload = (await response.json()) as StartAuthResponse
  if (!payload.authorizationUrl) {
    throw new AuthRequestError("Provider did not return an authorization URL.", 503)
  }

  await openAuthSessionUrl(payload.authorizationUrl)
}

export async function exchangeDesktopAuthCode(
  code: string,
  codeVerifier: string,
): Promise<StoredAuthSession> {
  const response = await fetchAuthResponse(buildUrl("/auth/desktop/token"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
    }),
  })

  if (!response.ok) {
    throw await parseAuthError(response)
  }

  return toStoredSession((await response.json()) as DesktopTokenResponse)
}

export async function pollGitHubDesktopSession(
  state: string,
  codeVerifier: string,
  options: DesktopSessionPollOptions = {},
): Promise<StoredAuthSession> {
  const { signal } = options
  const timeoutAt = Date.now() + GITHUB_RECOVERY_TIMEOUT_MS
  let lastError: Error | null = null

  while (Date.now() < timeoutAt) {
    if (signal?.aborted) {
      throw abortError()
    }

    let response: Response

    try {
      response = await fetchAuthResponse(buildUrl("/auth/desktop/poll"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          state,
          code_verifier: codeVerifier,
        }),
        signal,
      })
    } catch (error) {
      if (isAbortError(error)) {
        throw error
      }

      lastError =
        error instanceof Error
          ? error
          : new Error(options.transientFailureMessage ?? "Sign-in failed")
      await delay(1250, signal)
      continue
    }

    if (response.status === 202) {
      await delay(1250, signal)
      continue
    }

    if (!response.ok) {
      throw await parseAuthError(response)
    }

    return toStoredSession((await response.json()) as DesktopTokenResponse)
  }

  if (lastError instanceof AuthRequestError) {
    throw lastError
  }

  throw new AuthRequestError(
    options.timeoutMessage ?? "Sign-in timed out. Finish the browser flow and try again.",
    408,
  )
}

export async function refreshDesktopUserSession(
  refreshToken: string,
): Promise<StoredAuthSession> {
  const startedAt = startStartupTimer()
  logStartupDebug("auth.session_refresh.start")

  try {
    const response = await fetchAuthResponse(buildUrl("/auth/desktop/refresh"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    })

    if (!response.ok) {
      logStartupDebug("auth.session_refresh.failed", {
        elapsedMs: elapsedStartupMs(startedAt),
        status: response.status,
      })
      throw await parseAuthError(response)
    }

    const session = toStoredSession((await response.json()) as DesktopTokenResponse)
    logStartupDebug("auth.session_refresh.completed", {
      elapsedMs: elapsedStartupMs(startedAt),
      expiresAt: session.expires_at,
    })
    return session
  } catch (error) {
    logStartupDebug("auth.session_refresh.failed", {
      elapsedMs: elapsedStartupMs(startedAt),
      ...summarizeStartupError(error),
    })
    throw error
  }
}

export async function fetchCurrentDesktopUser(accessToken: string): Promise<AuthUser> {
  const startedAt = startStartupTimer()
  logStartupDebug("auth.current_user.start")

  try {
    const response = await fetchAuthResponse(buildUrl("/users/me"), {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      logStartupDebug("auth.current_user.failed", {
        elapsedMs: elapsedStartupMs(startedAt),
        status: response.status,
      })
      throw await parseAuthError(response)
    }

    const user = (await response.json()) as AuthUser
    logStartupDebug("auth.current_user.completed", {
      elapsedMs: elapsedStartupMs(startedAt),
      hasGitHubLogin: Boolean(user.github_login),
      hasAvatarUrl: Boolean(user.avatar_url),
    })
    return user
  } catch (error) {
    logStartupDebug("auth.current_user.failed", {
      elapsedMs: elapsedStartupMs(startedAt),
      ...summarizeStartupError(error),
    })
    throw error
  }
}
