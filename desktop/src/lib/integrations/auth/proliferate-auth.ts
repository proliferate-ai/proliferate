import {
  openAuthSessionUrl,
  type StoredAuthSession,
  type StoredPendingAuthSession,
} from "@/platform/tauri/auth"
import {
  buildProliferateApiUrl,
} from "@/lib/infra/proliferate-api"
import {
  elapsedStartupMs,
  logStartupDebug,
  startStartupTimer,
  summarizeStartupError,
} from "@/lib/infra/debug-startup"

export interface AuthUser {
  id: string
  email: string
  display_name: string | null
  github_login?: string | null
  avatar_url?: string | null
  is_active?: boolean
  is_verified?: boolean
  role?: string
}

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

export interface GitHubDesktopAuthAvailability {
  enabled: boolean
  clientId: string | null
}

export interface GitHubDesktopSignInOptions {
  prompt?: "select_account"
}

export interface DesktopAuthCallback {
  url: string
  code: string
  state: string
}

const DESKTOP_REDIRECT_SCHEME = "proliferate"
const DESKTOP_REDIRECT_HOST = "auth"
const DESKTOP_REDIRECT_PATH = "/callback"
const GITHUB_RECOVERY_TIMEOUT_MS = 2 * 60 * 1000
export const DESKTOP_AUTH_REDIRECT_URI = `${DESKTOP_REDIRECT_SCHEME}://${DESKTOP_REDIRECT_HOST}${DESKTOP_REDIRECT_PATH}`
export const PENDING_AUTH_MAX_AGE_MS = 10 * 60 * 1000
const CLOUD_UNAVAILABLE_MESSAGE =
  "Could not reach the Proliferate cloud. Local workspaces still work; sign-in requires the control plane."
const GITHUB_APP_SETTINGS_FALLBACK_URL = "https://github.com/settings/applications"

class AuthRequestError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "AuthRequestError"
    this.status = status
  }
}

function buildUrl(path: string): string {
  return buildProliferateApiUrl(path)
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function randomBase64Url(size = 32): string {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  return bytesToBase64Url(bytes)
}

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  )
  return bytesToBase64Url(new Uint8Array(digest))
}

function abortError(): Error {
  return new DOMException("Aborted", "AbortError")
}

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError"
}

function normalizeTransportError(error: unknown): Error {
  if (isAbortError(error)) {
    return error
  }

  if (error instanceof AuthRequestError) {
    return error
  }

  return new AuthRequestError(CLOUD_UNAVAILABLE_MESSAGE, 503)
}

async function fetchAuthResponse(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (error) {
    throw normalizeTransportError(error)
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }

    const timeout = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)

    function onAbort() {
      window.clearTimeout(timeout)
      reject(abortError())
    }

    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

async function parseError(response: Response): Promise<AuthRequestError> {
  try {
    const payload = (await response.json()) as { detail?: unknown }
    if (typeof payload.detail === "string") {
      return new AuthRequestError(payload.detail, response.status)
    }
  } catch {
    // Fall through to status text.
  }

  return new AuthRequestError(
    response.statusText || "Authentication request failed",
    response.status,
  )
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

export function createPendingGitHubDesktopAuth(): StoredPendingAuthSession {
  return {
    state: randomBase64Url(24),
    code_verifier: randomBase64Url(48),
    redirect_uri: DESKTOP_AUTH_REDIRECT_URI,
    created_at: new Date().toISOString(),
    last_handled_callback_url: null,
  }
}

export function isPendingDesktopAuthExpired(
  pending: StoredPendingAuthSession,
  now = Date.now(),
): boolean {
  const createdAt = Date.parse(pending.created_at)
  if (Number.isNaN(createdAt)) return true
  return now - createdAt > PENDING_AUTH_MAX_AGE_MS
}

export function parseDesktopAuthCallback(url: string): DesktopAuthCallback | null {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  if (parsed.protocol !== `${DESKTOP_REDIRECT_SCHEME}:`) {
    return null
  }

  if (parsed.hostname !== DESKTOP_REDIRECT_HOST) {
    return null
  }

  if (parsed.pathname !== DESKTOP_REDIRECT_PATH) {
    return null
  }

  const code = parsed.searchParams.get("code")
  const state = parsed.searchParams.get("state")
  if (!code || !state) {
    return null
  }

  return {
    url: parsed.toString(),
    code,
    state,
  }
}

export function isSessionExpiring(session: StoredAuthSession, skewSeconds = 60): boolean {
  const expiresAt = Date.parse(session.expires_at)
  if (Number.isNaN(expiresAt)) return true
  return expiresAt - Date.now() <= skewSeconds * 1000
}

export function sessionUser(session: StoredAuthSession): AuthUser {
  return {
    id: session.user_id,
    email: session.email,
    display_name: session.display_name,
    github_login: session.github_login ?? null,
    avatar_url: session.avatar_url ?? null,
  }
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
      throw await parseError(response)
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
  const codeChallenge = await sha256Base64Url(codeVerifier)
  const authorizeUrl = new URL(buildUrl("/auth/desktop/github/authorize"))
  authorizeUrl.searchParams.set("state", state)
  authorizeUrl.searchParams.set("code_challenge", codeChallenge)
  authorizeUrl.searchParams.set("code_challenge_method", "S256")
  authorizeUrl.searchParams.set("redirect_uri", redirectUri)
  if (options?.prompt) {
    authorizeUrl.searchParams.set("prompt", options.prompt)
  }

  await openAuthSessionUrl(authorizeUrl.toString())
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
    throw await parseError(response)
  }

  return toStoredSession((await response.json()) as DesktopTokenResponse)
}

export async function pollGitHubDesktopSession(
  state: string,
  codeVerifier: string,
  signal?: AbortSignal,
): Promise<StoredAuthSession> {
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
          : new Error("GitHub sign-in failed")
      await delay(1250, signal)
      continue
    }

    if (response.status === 202) {
      await delay(1250, signal)
      continue
    }

    if (!response.ok) {
      throw await parseError(response)
    }

    return toStoredSession((await response.json()) as DesktopTokenResponse)
  }

  if (lastError instanceof AuthRequestError) {
    throw lastError
  }

  throw new AuthRequestError(
    "GitHub sign-in timed out. Finish the browser flow and try again.",
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
      throw await parseError(response)
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
      throw await parseError(response)
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

export { AuthRequestError }
