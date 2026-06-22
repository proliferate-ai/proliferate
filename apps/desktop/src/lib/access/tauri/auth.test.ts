// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { StoredAuthSession } from "@/lib/domain/auth/stored-auth-session"

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  trackProductEvent: vi.fn(),
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}))

vi.mock("@/lib/integrations/telemetry/client", () => ({
  trackProductEvent: mocks.trackProductEvent,
}))

const SESSION: StoredAuthSession = {
  access_token: "access",
  refresh_token: "refresh",
  expires_at: "2026-06-10T00:00:00Z",
  user_id: "user-1",
  email: "user@example.com",
  display_name: null,
}

const PENDING_SESSION = {
  state: "state",
  code_verifier: "verifier",
  redirect_uri: "proliferate://auth/callback",
  created_at: "2026-06-10T00:00:00Z",
  last_handled_callback_url: null,
}

// reportKeychainFailure dedupes per module instance, so each test loads a
// fresh copy of the module under test.
async function loadAuthAccess() {
  vi.resetModules()
  return import("./auth")
}

async function flushTelemetry() {
  await vi.waitFor(() => {
    expect(mocks.trackProductEvent).toHaveBeenCalled()
  })
}

function installLocalStorageMock() {
  const store = new Map<string, string>()
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, value)
      }),
      removeItem: vi.fn((key: string) => {
        store.delete(key)
      }),
    },
  })
}

describe("tauri auth access", () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.trackProductEvent.mockReset()
    installLocalStorageMock()
  })

  it("returns the native session without telemetry when invoke succeeds", async () => {
    const auth = await loadAuthAccess()
    mocks.invoke.mockResolvedValue({ session: null })

    expect(await auth.getStoredAuthSession()).toBeNull()

    mocks.invoke.mockResolvedValue({ session: SESSION })
    expect(await auth.getStoredAuthSession()).toEqual(SESSION)
    expect(mocks.trackProductEvent).not.toHaveBeenCalled()
  })

  it("returns the native pending auth record without telemetry when invoke succeeds", async () => {
    const auth = await loadAuthAccess()
    mocks.invoke.mockResolvedValue({ record: PENDING_SESSION })

    expect(await auth.getStoredPendingAuthSession()).toEqual(PENDING_SESSION)
    expect(mocks.trackProductEvent).not.toHaveBeenCalled()
  })

  it("falls back to localStorage and reports when the keychain read fails", async () => {
    const auth = await loadAuthAccess()
    window.localStorage.setItem("proliferate.auth.session", JSON.stringify(SESSION))
    mocks.invoke.mockRejectedValue(new Error("keychain access denied"))

    expect(await auth.getStoredAuthSession()).toEqual(SESSION)

    await flushTelemetry()
    expect(mocks.trackProductEvent).toHaveBeenCalledWith(
      "desktop_keychain_access_failed",
      {
        operation: "get_auth_session",
        error_message: "keychain access denied",
      },
    )
  })

  it("falls back to localStorage and reports when the native read never settles", async () => {
    vi.useFakeTimers()
    try {
      const auth = await loadAuthAccess()
      window.localStorage.setItem("proliferate.auth.session", JSON.stringify(SESSION))
      mocks.invoke.mockImplementation(() => new Promise(() => {}))

      const session = auth.getStoredAuthSession()
      await vi.advanceTimersByTimeAsync(1_500)

      await expect(session).resolves.toEqual(SESSION)
      await flushTelemetry()
      expect(mocks.trackProductEvent).toHaveBeenCalledWith(
        "desktop_keychain_access_failed",
        {
          operation: "get_auth_session",
          error_message: "get_auth_session timed out",
        },
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it("reports each operation at most once per run", async () => {
    const auth = await loadAuthAccess()
    mocks.invoke.mockRejectedValue(new Error("denied"))

    await auth.getStoredAuthSession()
    await auth.getStoredAuthSession()
    await auth.setStoredAuthSession(SESSION)

    await vi.waitFor(() => {
      expect(mocks.trackProductEvent).toHaveBeenCalledTimes(2)
    })
    const operations = mocks.trackProductEvent.mock.calls.map(
      ([, properties]) => (properties as { operation: string }).operation,
    )
    expect(operations).toEqual(["get_auth_session", "set_auth_session"])
  })

  it("writes the localStorage fallback when the keychain write fails", async () => {
    const auth = await loadAuthAccess()
    mocks.invoke.mockRejectedValue(new Error("denied"))

    await auth.setStoredAuthSession(SESSION)

    expect(
      JSON.parse(window.localStorage.getItem("proliferate.auth.session") ?? "null"),
    ).toEqual(SESSION)
    await flushTelemetry()
  })

  it("clears the localStorage fallback when the keychain clear fails", async () => {
    const auth = await loadAuthAccess()
    window.localStorage.setItem("proliferate.auth.session", JSON.stringify(SESSION))
    mocks.invoke.mockRejectedValue(new Error("denied"))

    await auth.clearStoredAuthSession()

    expect(window.localStorage.getItem("proliferate.auth.session")).toBeNull()
    await flushTelemetry()
  })
})
