import type {
  StoredPendingAuthSession,
  StoredPendingAuthProvider,
  StoredPendingAuthPurpose,
} from "@/lib/access/tauri/auth"

export interface DesktopAuthCallback {
  url: string
  state: string
  code: string | null
  error: string | null
}

const DESKTOP_REDIRECT_SCHEME = "proliferate"
const LOCAL_DESKTOP_REDIRECT_SCHEME = "proliferate-local"
const DESKTOP_REDIRECT_SCHEMES = new Set([
  DESKTOP_REDIRECT_SCHEME,
  LOCAL_DESKTOP_REDIRECT_SCHEME,
])
const DESKTOP_REDIRECT_HOST = "auth"
const DESKTOP_REDIRECT_PATH = "/callback"

export const DESKTOP_AUTH_REDIRECT_URI = `${desktopRedirectScheme()}://${DESKTOP_REDIRECT_HOST}${DESKTOP_REDIRECT_PATH}`
export const PENDING_AUTH_MAX_AGE_MS = 10 * 60 * 1000

export function createPendingDesktopAuth(
  provider: StoredPendingAuthProvider,
  purpose: StoredPendingAuthPurpose,
): StoredPendingAuthSession {
  return {
    provider,
    purpose,
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
  const parsed = parseDesktopAuthCallbackUrl(url)
  if (!parsed) {
    return null
  }

  const code = parsed.searchParams.get("code")
  const error = parsed.searchParams.get("error")
  const state = parsed.searchParams.get("state")
  if (!state || (!code && !error)) {
    return null
  }

  return {
    url: parsed.toString(),
    state,
    code,
    error,
  }
}

/** True for the Desktop auth callback transport even when its query is malformed. */
export function isDesktopAuthCallbackUrl(url: string): boolean {
  return parseDesktopAuthCallbackUrl(url) !== null
}

function parseDesktopAuthCallbackUrl(url: string): URL | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (!DESKTOP_REDIRECT_SCHEMES.has(parsed.protocol.replace(/:$/, ""))) {
    return null
  }
  if (parsed.hostname !== DESKTOP_REDIRECT_HOST) {
    return null
  }
  return parsed.pathname === DESKTOP_REDIRECT_PATH ? parsed : null
}

export async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  )
  return bytesToBase64Url(new Uint8Array(digest))
}

function isLocalDesktopHost(): boolean {
  if (typeof window === "undefined") {
    return false
  }
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)
}

function desktopRedirectScheme(): string {
  return isLocalDesktopHost() ? LOCAL_DESKTOP_REDIRECT_SCHEME : DESKTOP_REDIRECT_SCHEME
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
