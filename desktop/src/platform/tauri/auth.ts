import { invoke } from "@tauri-apps/api/core"

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
  } catch {
    return readBrowserSession()
  }
}

export async function setStoredAuthSession(session: StoredAuthSession): Promise<void> {
  try {
    await invoke("set_auth_session", { session })
    return
  } catch {
    writeBrowserSession(session)
  }
}

export async function clearStoredAuthSession(): Promise<void> {
  try {
    await invoke("clear_auth_session")
    return
  } catch {
    clearBrowserSession()
  }
}

export async function getStoredPendingAuthSession(): Promise<StoredPendingAuthSession | null> {
  try {
    return await invoke<StoredPendingAuthSession | null>("get_pending_auth")
  } catch {
    return readBrowserPendingAuth()
  }
}

export async function setStoredPendingAuthSession(
  record: StoredPendingAuthSession,
): Promise<void> {
  try {
    await invoke("set_pending_auth", { record })
    return
  } catch {
    writeBrowserPendingAuth(record)
  }
}

export async function clearStoredPendingAuthSession(): Promise<void> {
  try {
    await invoke("clear_pending_auth")
    return
  } catch {
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
