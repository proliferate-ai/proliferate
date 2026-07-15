import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthOrchestrationDeps } from "@/lib/integrations/auth/orchestration-effects";

const m = vi.hoisted(() => ({
  getStoredPendingAuthSession: vi.fn(),
  clearStoredPendingAuthSession: vi.fn(async () => {}),
  setStoredPendingAuthSession: vi.fn(async () => {}),
  setStoredAuthSession: vi.fn(async () => {}),
  clearStoredAuthSession: vi.fn(async () => {}),
  getActiveGitHubSignIn: vi.fn(() => null as { state: string } | null),
  rejectGitHubSignIn: vi.fn(),
  resolveGitHubSignIn: vi.fn(),
  cancelGitHubSignIn: vi.fn(),
  isDevAuthBypassed: vi.fn(() => false),
  createDevBypassSession: vi.fn(),
  exchangeDesktopAuthCode: vi.fn(),
  isPendingDesktopAuthExpired: vi.fn(() => false),
  parseDesktopAuthCallback: vi.fn(),
  captureTelemetryException: vi.fn(),
}));

vi.mock("@/lib/access/tauri/auth", () => ({
  getStoredPendingAuthSession: m.getStoredPendingAuthSession,
  clearStoredPendingAuthSession: m.clearStoredPendingAuthSession,
  setStoredPendingAuthSession: m.setStoredPendingAuthSession,
  setStoredAuthSession: m.setStoredAuthSession,
  clearStoredAuthSession: m.clearStoredAuthSession,
}));
vi.mock("@/lib/domain/auth/github-signin-state", () => ({
  getActiveGitHubSignIn: m.getActiveGitHubSignIn,
  rejectGitHubSignIn: m.rejectGitHubSignIn,
  resolveGitHubSignIn: m.resolveGitHubSignIn,
  cancelGitHubSignIn: m.cancelGitHubSignIn,
}));
vi.mock("@/lib/domain/auth/auth-mode", () => ({
  isDevAuthBypassed: m.isDevAuthBypassed,
  createDevBypassSession: m.createDevBypassSession,
}));
vi.mock("@/lib/integrations/auth/proliferate-auth", () => ({
  exchangeDesktopAuthCode: m.exchangeDesktopAuthCode,
  isPendingDesktopAuthExpired: m.isPendingDesktopAuthExpired,
  parseDesktopAuthCallback: m.parseDesktopAuthCallback,
  isSessionExpiring: vi.fn(() => false),
  refreshDesktopUserSession: vi.fn(),
  fetchCurrentDesktopUser: vi.fn(),
  AuthRequestError: class AuthRequestError extends Error {
    status = 0;
  },
}));
vi.mock("@/lib/integrations/telemetry/client", () => ({
  captureTelemetryException: m.captureTelemetryException,
}));

import { handleDesktopCallbackUrl } from "@/lib/integrations/auth/orchestration-callback";

const CALLBACK_URL = "proliferate://auth/callback?code=abc&state=s1";

function makeDeps(): AuthOrchestrationDeps {
  return {
    getAuthState: vi.fn(() => ({
      status: "anonymous" as const,
      session: null,
      user: null,
      error: null,
      issue: null,
    })),
    setAuthState: vi.fn(),
    clearSessionRuntimeState: vi.fn(),
    closeRepoSetupModal: vi.fn(),
    showToast: vi.fn(),
  };
}

function pending(overrides: Record<string, unknown> = {}) {
  return {
    state: "s1",
    code_verifier: "verifier",
    redirect_uri: "proliferate://auth/callback",
    created_at: new Date().toISOString(),
    last_handled_callback_url: null,
    ...overrides,
  };
}

function callback(overrides: Record<string, unknown> = {}) {
  return {
    url: CALLBACK_URL,
    state: "s1",
    code: "abc",
    error: null,
    ...overrides,
  };
}

function session() {
  return {
    access_token: "at",
    refresh_token: "rt",
    user_id: "u1",
    email: "ada@example.test",
    display_name: "Ada",
    github_login: "ada",
    avatar_url: null,
  };
}

function lastIssue(deps: AuthOrchestrationDeps) {
  const calls = (deps.setAuthState as ReturnType<typeof vi.fn>).mock.calls;
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    if (calls[i][0] && "issue" in calls[i][0]) {
      return calls[i][0].issue;
    }
  }
  return undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.isDevAuthBypassed.mockReturnValue(false);
  m.isPendingDesktopAuthExpired.mockReturnValue(false);
  m.getActiveGitHubSignIn.mockReturnValue(null);
  m.parseDesktopAuthCallback.mockReturnValue(callback());
  m.getStoredPendingAuthSession.mockResolvedValue(pending());
});

describe("handleDesktopCallbackUrl state machine", () => {
  it("exchanges once and commits an authenticated snapshot on success", async () => {
    m.exchangeDesktopAuthCode.mockResolvedValue(session());
    const deps = makeDeps();

    const result = await handleDesktopCallbackUrl(CALLBACK_URL, deps);

    expect(result).toBe(true);
    expect(m.exchangeDesktopAuthCode).toHaveBeenCalledTimes(1);
    expect(m.exchangeDesktopAuthCode).toHaveBeenCalledWith("abc", "verifier");
    expect(m.resolveGitHubSignIn).toHaveBeenCalledWith("s1", session());
    expect(m.clearStoredPendingAuthSession).toHaveBeenCalled();
    expect(deps.setAuthState).toHaveBeenCalledWith(
      expect.objectContaining({ status: "authenticated" }),
    );
  });

  it("routes a provider error to a callback issue without exchanging", async () => {
    m.parseDesktopAuthCallback.mockReturnValue(
      callback({ code: null, error: "access_denied" }),
    );
    const deps = makeDeps();

    const result = await handleDesktopCallbackUrl(CALLBACK_URL, deps);

    expect(result).toBe(true);
    expect(m.exchangeDesktopAuthCode).not.toHaveBeenCalled();
    expect(m.cancelGitHubSignIn).toHaveBeenCalled(); // pending cleared
    expect(lastIssue(deps)).toEqual({
      kind: "callback_failed",
      reason: "provider_error",
      providerCode: "access_denied",
    });
  });

  it("treats a missing authorization code as a malformed callback and clears pending", async () => {
    m.parseDesktopAuthCallback.mockReturnValue(callback({ code: null }));
    const deps = makeDeps();

    const result = await handleDesktopCallbackUrl(CALLBACK_URL, deps);

    expect(result).toBe(false);
    expect(m.exchangeDesktopAuthCode).not.toHaveBeenCalled();
    expect(m.cancelGitHubSignIn).toHaveBeenCalled();
    expect(lastIssue(deps)).toEqual({
      kind: "callback_failed",
      reason: "malformed_callback",
    });
  });

  it("treats an expired pending transaction as expired, clears it, and does not exchange", async () => {
    m.isPendingDesktopAuthExpired.mockReturnValue(true);
    const deps = makeDeps();

    const result = await handleDesktopCallbackUrl(CALLBACK_URL, deps);

    expect(result).toBe(false);
    expect(m.exchangeDesktopAuthCode).not.toHaveBeenCalled();
    expect(m.cancelGitHubSignIn).toHaveBeenCalled();
    expect(lastIssue(deps)).toEqual({
      kind: "callback_failed",
      reason: "expired",
    });
  });

  it("on state mismatch publishes an issue but never destroys the different valid pending", async () => {
    m.parseDesktopAuthCallback.mockReturnValue(
      callback({ state: "other", url: "proliferate://auth/callback?state=other" }),
    );
    const deps = makeDeps();

    const result = await handleDesktopCallbackUrl(
      "proliferate://auth/callback?state=other",
      deps,
    );

    expect(result).toBe(false);
    expect(m.exchangeDesktopAuthCode).not.toHaveBeenCalled();
    // The mismatched callback must not clear the pending transaction.
    expect(m.clearStoredPendingAuthSession).not.toHaveBeenCalled();
    expect(m.cancelGitHubSignIn).not.toHaveBeenCalled();
    expect(lastIssue(deps)).toEqual({
      kind: "callback_failed",
      reason: "state_mismatch",
    });
  });

  it("makes exchange failure terminal: clears pending, publishes exchange_failed, no retry marker restore", async () => {
    m.getActiveGitHubSignIn.mockReturnValue({ state: "s1" });
    m.exchangeDesktopAuthCode.mockRejectedValue(new Error("token endpoint 500"));
    // The catch re-reads pending; it is still ours.
    m.getStoredPendingAuthSession
      .mockResolvedValueOnce(pending())
      .mockResolvedValueOnce(pending());
    const deps = makeDeps();

    const result = await handleDesktopCallbackUrl(CALLBACK_URL, deps);

    expect(result).toBe(false);
    expect(m.clearStoredPendingAuthSession).toHaveBeenCalled();
    expect(m.rejectGitHubSignIn).toHaveBeenCalled();
    // No marker restore: setStoredPendingAuthSession is only the pre-exchange
    // mark, never a post-failure restore.
    expect(m.setStoredPendingAuthSession).toHaveBeenCalledTimes(1);
    expect(lastIssue(deps)).toEqual({
      kind: "callback_failed",
      reason: "exchange_failed",
    });
  });

  it("does not clobber a newer login when the exchange fails after the pending was replaced", async () => {
    m.exchangeDesktopAuthCode.mockRejectedValue(new Error("boom"));
    m.getStoredPendingAuthSession
      .mockResolvedValueOnce(pending())
      .mockResolvedValueOnce(pending({ state: "newer" }));
    const deps = makeDeps();

    const result = await handleDesktopCallbackUrl(CALLBACK_URL, deps);

    expect(result).toBe(true);
    // The newer transaction is left intact; no terminal clear, no issue.
    expect(m.clearStoredPendingAuthSession).not.toHaveBeenCalled();
    expect(lastIssue(deps)).toBeUndefined();
  });

  it("observes the persisted already-consumed marker without a second exchange", async () => {
    m.getStoredPendingAuthSession.mockResolvedValue(
      pending({ last_handled_callback_url: CALLBACK_URL }),
    );
    const deps = makeDeps();

    const result = await handleDesktopCallbackUrl(CALLBACK_URL, deps);

    expect(result).toBe(true);
    expect(m.exchangeDesktopAuthCode).not.toHaveBeenCalled();
    expect(deps.setAuthState).not.toHaveBeenCalled();
  });

  it("single-flights a concurrent duplicate delivery into one exchange", async () => {
    let resolveExchange: (value: unknown) => void = () => {};
    m.exchangeDesktopAuthCode.mockReturnValue(
      new Promise((resolve) => {
        resolveExchange = resolve;
      }),
    );
    const deps = makeDeps();

    const first = handleDesktopCallbackUrl(CALLBACK_URL, deps);
    const second = handleDesktopCallbackUrl(CALLBACK_URL, deps);
    resolveExchange(session());
    const [a, b] = await Promise.all([first, second]);

    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(m.exchangeDesktopAuthCode).toHaveBeenCalledTimes(1);
  });

  it("returns false without touching auth when there is no pending transaction", async () => {
    m.getStoredPendingAuthSession.mockResolvedValue(null);
    const deps = makeDeps();

    const result = await handleDesktopCallbackUrl(CALLBACK_URL, deps);

    expect(result).toBe(false);
    expect(m.exchangeDesktopAuthCode).not.toHaveBeenCalled();
    expect(deps.setAuthState).not.toHaveBeenCalled();
  });

  it("does not consume a non-auth navigation deep link (auth transport only)", async () => {
    // A navigation deep link is not an auth callback: the parser rejects it and
    // the transport returns false without touching auth state. Product routing
    // (use-product-entry-routing) owns these URLs now.
    m.parseDesktopAuthCallback.mockReturnValue(null);
    const deps = makeDeps();

    const result = await handleDesktopCallbackUrl("proliferate://settings/account", deps);

    expect(result).toBe(false);
    expect(m.exchangeDesktopAuthCode).not.toHaveBeenCalled();
    expect(deps.setAuthState).not.toHaveBeenCalled();
  });

  it("returns false in dev-bypass mode without exchanging", async () => {
    m.isDevAuthBypassed.mockReturnValue(true);
    const deps = makeDeps();

    const result = await handleDesktopCallbackUrl(CALLBACK_URL, deps);

    expect(result).toBe(false);
    expect(m.parseDesktopAuthCallback).not.toHaveBeenCalled();
    expect(m.exchangeDesktopAuthCode).not.toHaveBeenCalled();
  });
});
