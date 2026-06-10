import { invoke } from "@tauri-apps/api/core"

import type { KeychainTelemetryOperation } from "@/lib/domain/telemetry/events"

export interface StoredAuthSession {
  access_token: string
  refresh_token: string
  expires_at: string
  user_id: string
  email: string
  display_name: string | null
  github_login?: string | null
  avatar_url?: string | null
}

export interface StoredPendingAuthSession {
  state: string
  code_verifier: string
  redirect_uri: string
  created_at: string
  last_handled_callback_url: string | null
}

const BROWSER_AUTH_SESSION_KEY = "proliferate.auth.session"
const BROWSER_PENDING_AUTH_KEY = "proliferate.auth.pending"

const reportedKeychainFailures = new Set<KeychainTelemetryOperation>()

// A rejected invoke means native auth storage is broken (e.g. a keychain item
// whose ACL no longer trusts this binary) — the silent localStorage fallback
// then looks like "logged out" with no trace. Report once per operation per
// app run; the telemetry client is imported lazily because this access-layer
// module must not pull in the integrations layer at module scope.
function reportKeychainFailure(
  operation: KeychainTelemetryOperation,
  error: unknown,
): void {
  if (reportedKeychainFailures.has(operation)) return
  reportedKeychainFailures.add(operation)
  const message = error instanceof Error ? error.message : String(error ?? "")
  void import("@/lib/integrations/telemetry/client")
    .then(({ trackProductEvent }) => {
      trackProductEvent("desktop_keychain_access_failed", {
        operation,
        error_message: message.slice(0, 300),
      })
    })
    .catch(() => {})
}

function readBrowserSession(): StoredAuthSession | null {
  try {
    const raw = window.localStorage.getItem(BROWSER_AUTH_SESSION_KEY)
    if (!raw) return null
    return JSON.parse(raw) as StoredAuthSession
  } catch {
    return null
  }
}

function writeBrowserSession(session: StoredAuthSession): void {
  try {
    window.localStorage.setItem(BROWSER_AUTH_SESSION_KEY, JSON.stringify(session))
  } catch {
    // Ignore browser persistence failures.
  }
}

function clearBrowserSession(): void {
  try {
    window.localStorage.removeItem(BROWSER_AUTH_SESSION_KEY)
  } catch {
    // Ignore browser persistence failures.
  }
}

function readBrowserPendingAuth(): StoredPendingAuthSession | null {
  try {
    const raw = window.localStorage.getItem(BROWSER_PENDING_AUTH_KEY)
    if (!raw) return null
    return JSON.parse(raw) as StoredPendingAuthSession
  } catch {
    return null
  }
}

function writeBrowserPendingAuth(record: StoredPendingAuthSession): void {
  try {
    window.localStorage.setItem(BROWSER_PENDING_AUTH_KEY, JSON.stringify(record))
  } catch {
    // Ignore browser persistence failures.
  }
}

function clearBrowserPendingAuth(): void {
  try {
    window.localStorage.removeItem(BROWSER_PENDING_AUTH_KEY)
  } catch {
    // Ignore browser persistence failures.
  }
}

export async function getStoredAuthSession(): Promise<StoredAuthSession | null> {
  try {
    return await invoke<StoredAuthSession | null>("get_auth_session")
  } catch (error) {
    reportKeychainFailure("get_auth_session", error)
    return readBrowserSession()
  }
}

export async function setStoredAuthSession(session: StoredAuthSession): Promise<void> {
  try {
    await invoke("set_auth_session", { session })
    return
  } catch (error) {
    reportKeychainFailure("set_auth_session", error)
    writeBrowserSession(session)
  }
}

export async function clearStoredAuthSession(): Promise<void> {
  try {
    await invoke("clear_auth_session")
    return
  } catch (error) {
    reportKeychainFailure("clear_auth_session", error)
    clearBrowserSession()
  }
}

export async function getStoredPendingAuthSession(): Promise<StoredPendingAuthSession | null> {
  try {
    return await invoke<StoredPendingAuthSession | null>("get_pending_auth")
  } catch (error) {
    reportKeychainFailure("get_pending_auth", error)
    return readBrowserPendingAuth()
  }
}

export async function setStoredPendingAuthSession(
  record: StoredPendingAuthSession,
): Promise<void> {
  try {
    await invoke("set_pending_auth", { record })
    return
  } catch (error) {
    reportKeychainFailure("set_pending_auth", error)
    writeBrowserPendingAuth(record)
  }
}

export async function clearStoredPendingAuthSession(): Promise<void> {
  try {
    await invoke("clear_pending_auth")
    return
  } catch (error) {
    reportKeychainFailure("clear_pending_auth", error)
    clearBrowserPendingAuth()
  }
}

export async function openAuthSessionUrl(url: string): Promise<void> {
  try {
    await invoke("open_external", { url })
    return
  } catch {
    window.open(url, "_blank", "noopener,noreferrer")
  }
}
