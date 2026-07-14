import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthClientState } from "@/lib/domain/auth/auth-state-mapping";
import type { StoredAuthSession } from "@/lib/domain/auth/stored-auth-session";
import type { AuthOrchestrationDeps } from "./orchestration-effects";

const h = vi.hoisted(() => ({
  events: [] as string[],
  storedSession: null as unknown,
  initialCallbackUrl: null as string | null,
  bridgeHandler: null as null | ((url: string) => Promise<boolean>),
  ensureDeepLinkBridge: vi.fn(),
  getStoredAuthSession: vi.fn(),
  getStoredPendingAuthSession: vi.fn(),
  setStoredAuthSession: vi.fn(),
  clearStoredAuthSession: vi.fn(),
  clearStoredPendingAuthSession: vi.fn(),
  checkControlPlaneReachable: vi.fn(),
  handleDesktopCallbackUrl: vi.fn(),
  validateSession: vi.fn(),
}));

vi.mock("@/lib/access/tauri/deep-link", () => ({
  ensureDeepLinkBridge: h.ensureDeepLinkBridge,
}));

vi.mock("@/lib/access/tauri/auth", () => ({
  clearStoredPendingAuthSession: h.clearStoredPendingAuthSession,
  getStoredAuthSession: h.getStoredAuthSession,
  getStoredPendingAuthSession: h.getStoredPendingAuthSession,
  setStoredAuthSession: h.setStoredAuthSession,
  clearStoredAuthSession: h.clearStoredAuthSession,
}));

vi.mock("@/lib/access/cloud/health", () => ({
  checkControlPlaneReachable: h.checkControlPlaneReachable,
}));

vi.mock("@/lib/domain/auth/auth-mode", () => ({
  isDevAuthBypassed: () => false,
}));

vi.mock("./orchestration-callback", () => ({
  handleDesktopCallbackUrl: h.handleDesktopCallbackUrl,
}));

vi.mock("./orchestration-effects", async () => {
  const actual = await vi.importActual<
    typeof import("./orchestration-effects")
  >("./orchestration-effects");
  return {
    ...actual,
    validateSession: h.validateSession,
  };
});

import { bootstrapAuth } from "./orchestration-bootstrap";
import { applyAuthenticatedState } from "./orchestration-effects";
import { resetDesktopAuthTransactionForRestore } from "./desktop-auth-transaction";

const INITIAL_CALLBACK_URL =
  "proliferate://auth/callback?code=code-1&state=state-1";

const SESSION: StoredAuthSession = {
  access_token: "access-1",
  refresh_token: "refresh-1",
  expires_at: "2099-01-01T00:00:00.000Z",
  user_id: "user-1",
  email: "ada@example.test",
  display_name: "Ada",
};

const USER = {
  id: "user-1",
  email: "ada@example.test",
  display_name: "Ada",
};

const REPLACEMENT_SESSION: StoredAuthSession = {
  ...SESSION,
  access_token: "access-2",
  refresh_token: "refresh-2",
};

function createDeps(): {
  deps: AuthOrchestrationDeps;
  getState: () => AuthClientState;
} {
  let state: AuthClientState = {
    status: "anonymous",
    session: null,
    user: null,
    error: null,
    issue: null,
  };

  const deps: AuthOrchestrationDeps = {
    getAuthState: () => state,
    setAuthState: (patch) => {
      state = { ...state, ...patch };
    },
    clearSessionRuntimeState: vi.fn(),
    closeRepoSetupModal: vi.fn(),
    showToast: vi.fn(),
  };

  return { deps, getState: () => state };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.events.length = 0;
  h.storedSession = null;
  h.initialCallbackUrl = INITIAL_CALLBACK_URL;
  h.bridgeHandler = null;
  resetDesktopAuthTransactionForRestore();

  h.getStoredAuthSession.mockImplementation(async () => {
    h.events.push("session:read");
    return h.storedSession;
  });
  h.setStoredAuthSession.mockImplementation(async (session) => {
    h.storedSession = session;
  });
  h.clearStoredAuthSession.mockImplementation(async () => {
    h.storedSession = null;
  });
  h.getStoredPendingAuthSession.mockResolvedValue(null);
  h.clearStoredPendingAuthSession.mockResolvedValue(undefined);
  h.checkControlPlaneReachable.mockResolvedValue(true);
  h.validateSession.mockResolvedValue({ session: SESSION, user: USER });

  h.ensureDeepLinkBridge.mockImplementation(async (handler) => {
    h.bridgeHandler = handler;
    if (!h.initialCallbackUrl) {
      return;
    }
    h.events.push("bridge:callback:start");
    await handler(h.initialCallbackUrl);
    h.events.push("bridge:callback:complete");
  });
});

describe("bootstrapAuth initial deep-link drain", () => {
  it("uses the session committed by the initial callback instead of stale anonymous state", async () => {
    const { deps, getState } = createDeps();
    h.handleDesktopCallbackUrl.mockImplementation(async (_url, callbackDeps) => {
      h.storedSession = SESSION;
      callbackDeps.setAuthState({
        status: "authenticated",
        session: SESSION,
        user: USER,
        error: null,
        issue: null,
      });
      return true;
    });

    await bootstrapAuth(deps);

    expect(h.events).toEqual([
      "bridge:callback:start",
      "bridge:callback:complete",
      "session:read",
      "session:read",
    ]);
    expect(h.validateSession).toHaveBeenCalledOnce();
    expect(h.validateSession).toHaveBeenCalledWith(SESSION);
    expect(getState()).toMatchObject({
      status: "authenticated",
      session: SESSION,
      user: USER,
      error: null,
      issue: null,
    });
  });

  it("preserves a terminal callback issue while settling anonymous", async () => {
    const { deps, getState } = createDeps();
    h.handleDesktopCallbackUrl.mockImplementation(async (_url, callbackDeps) => {
      callbackDeps.setAuthState({
        issue: {
          kind: "callback_failed",
          reason: "provider_error",
          providerCode: "access_denied",
        },
      });
      return true;
    });

    await bootstrapAuth(deps);

    expect(h.events).toEqual([
      "bridge:callback:start",
      "bridge:callback:complete",
      "session:read",
      "session:read",
    ]);
    expect(h.validateSession).not.toHaveBeenCalled();
    expect(getState()).toEqual({
      status: "anonymous",
      session: null,
      user: null,
      error: null,
      issue: {
        kind: "callback_failed",
        reason: "provider_error",
        providerCode: "access_denied",
      },
    });
  });

  it("does not settle anonymous over a live callback that commits while health is pending", async () => {
    const health = deferred<boolean>();
    const { deps, getState } = createDeps();
    h.initialCallbackUrl = null;
    h.checkControlPlaneReachable.mockReturnValue(health.promise);
    h.handleDesktopCallbackUrl.mockImplementation(async (_url, callbackDeps) =>
      applyAuthenticatedState(callbackDeps, REPLACEMENT_SESSION));

    const bootstrap = bootstrapAuth(deps);
    await vi.waitFor(() => expect(h.events).toContain("session:read"));
    await h.bridgeHandler?.(INITIAL_CALLBACK_URL);
    health.resolve(true);
    await bootstrap;

    expect(h.storedSession).toEqual(REPLACEMENT_SESSION);
    expect(getState()).toMatchObject({
      status: "authenticated",
      session: REPLACEMENT_SESSION,
      issue: null,
    });
  });

  it("does not clear replacement state when stale health resolves unreachable", async () => {
    const health = deferred<boolean>();
    const { deps, getState } = createDeps();
    h.initialCallbackUrl = null;
    h.checkControlPlaneReachable.mockReturnValue(health.promise);
    h.handleDesktopCallbackUrl.mockImplementation(async (_url, callbackDeps) =>
      applyAuthenticatedState(callbackDeps, REPLACEMENT_SESSION));

    const bootstrap = bootstrapAuth(deps);
    await vi.waitFor(() => expect(h.events).toContain("session:read"));
    await h.bridgeHandler?.(INITIAL_CALLBACK_URL);
    health.resolve(false);
    await bootstrap;

    expect(h.storedSession).toEqual(REPLACEMENT_SESSION);
    expect(getState()).toMatchObject({
      status: "authenticated",
      session: REPLACEMENT_SESSION,
    });
    expect(h.clearStoredPendingAuthSession).not.toHaveBeenCalled();
    expect(deps.clearSessionRuntimeState).not.toHaveBeenCalled();
  });

  it("does not restore a validated old session over a live replacement callback", async () => {
    const validation = deferred<{ session: StoredAuthSession; user: typeof USER }>();
    const { deps, getState } = createDeps();
    h.initialCallbackUrl = null;
    h.storedSession = SESSION;
    h.validateSession.mockReturnValue(validation.promise);
    h.handleDesktopCallbackUrl.mockImplementation(async (_url, callbackDeps) =>
      applyAuthenticatedState(callbackDeps, REPLACEMENT_SESSION));

    const bootstrap = bootstrapAuth(deps);
    await vi.waitFor(() => expect(h.validateSession).toHaveBeenCalledWith(SESSION));
    await h.bridgeHandler?.(INITIAL_CALLBACK_URL);
    validation.resolve({ session: SESSION, user: USER });
    await bootstrap;

    expect(h.storedSession).toEqual(REPLACEMENT_SESSION);
    expect(getState()).toMatchObject({
      status: "authenticated",
      session: REPLACEMENT_SESSION,
      issue: null,
    });
  });

  it("preserves a live callback issue published while anonymous storage clears", async () => {
    const clear = deferred<void>();
    const { deps, getState } = createDeps();
    h.initialCallbackUrl = null;
    h.clearStoredAuthSession.mockReturnValue(clear.promise);
    h.handleDesktopCallbackUrl.mockImplementation(async (_url, callbackDeps) => {
      callbackDeps.setAuthState({
        issue: {
          kind: "callback_failed",
          reason: "provider_error",
          providerCode: "access_denied",
        },
      });
      return true;
    });

    const bootstrap = bootstrapAuth(deps);
    await vi.waitFor(() => expect(h.clearStoredAuthSession).toHaveBeenCalledOnce());
    await h.bridgeHandler?.(INITIAL_CALLBACK_URL);
    clear.resolve();
    await bootstrap;

    expect(getState()).toEqual({
      status: "anonymous",
      session: null,
      user: null,
      error: null,
      issue: {
        kind: "callback_failed",
        reason: "provider_error",
        providerCode: "access_denied",
      },
    });
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
