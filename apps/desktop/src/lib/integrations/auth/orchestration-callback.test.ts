import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredPendingAuthSession } from "@/lib/access/tauri/auth";
import type { AuthOrchestrationDeps } from "./orchestration-effects";

const h = vi.hoisted(() => ({
  pending: null as StoredPendingAuthSession | null,
  activeSignIn: null as { state: string } | null,
  exchangeDesktopAuthCode: vi.fn(),
  getStoredPendingAuthSession: vi.fn(),
  resolveGitHubSignIn: vi.fn(),
  rejectGitHubSignIn: vi.fn(),
  applyAuthenticatedState: vi.fn(async () => {}),
  clearPendingGitHubAuth: vi.fn(async () => true),
  markPendingCallbackUrl: vi.fn(async () => true),
  captureTelemetryException: vi.fn(),
}));

vi.mock("@/lib/access/tauri/auth", () => ({
  getStoredPendingAuthSession: h.getStoredPendingAuthSession,
}));
vi.mock("@/lib/domain/auth/github-signin-state", () => ({
  getActiveGitHubSignIn: () => h.activeSignIn,
  rejectGitHubSignIn: h.rejectGitHubSignIn,
  resolveGitHubSignIn: h.resolveGitHubSignIn,
}));
vi.mock("@/lib/domain/auth/auth-mode", () => ({
  isDevAuthBypassed: () => false,
}));
vi.mock("@/lib/integrations/auth/proliferate-auth", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/integrations/auth/proliferate-auth")
  >("@/lib/integrations/auth/proliferate-auth");
  return {
    ...actual,
    exchangeDesktopAuthCode: h.exchangeDesktopAuthCode,
  };
});
vi.mock("@/lib/integrations/telemetry/client", () => ({
  captureTelemetryException: h.captureTelemetryException,
}));
vi.mock("./orchestration-effects", () => ({
  applyAuthenticatedState: h.applyAuthenticatedState,
  clearPendingGitHubAuth: h.clearPendingGitHubAuth,
  markPendingCallbackUrl: h.markPendingCallbackUrl,
  markTelemetryHandled: (error: Error) => error,
  toError: (error: unknown, fallback: string) =>
    error instanceof Error ? error : new Error(fallback),
}));

import {
  beginDesktopAuthTransaction,
  handleDesktopCallbackUrl,
  resetDesktopAuthCallbackConsumption,
} from "./orchestration-callback";
import { registerDesktopAuthPendingState } from "./desktop-auth-transaction";

const SESSION = {
  access_token: "access",
  refresh_token: "refresh",
  expires_at: "2099-01-01T00:00:00.000Z",
  user_id: "user-1",
  email: "ada@example.test",
  display_name: "Ada",
};

function pending(overrides: Partial<StoredPendingAuthSession> = {}): StoredPendingAuthSession {
  return {
    provider: "github",
    purpose: "login",
    state: "state-1",
    code_verifier: "verifier-1",
    redirect_uri: "proliferate://auth/callback",
    created_at: new Date().toISOString(),
    last_handled_callback_url: null,
    ...overrides,
  };
}

function deps(): AuthOrchestrationDeps {
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

beforeEach(() => {
  vi.clearAllMocks();
  resetDesktopAuthCallbackConsumption();
  h.pending = pending();
  h.activeSignIn = null;
  h.getStoredPendingAuthSession.mockImplementation(async () => h.pending);
  h.exchangeDesktopAuthCode.mockResolvedValue(SESSION);
});

describe("handleDesktopCallbackUrl", () => {
  it("ignores non-auth deep links", async () => {
    const effects = deps();
    await expect(
      handleDesktopCallbackUrl("proliferate://workspace/ws-1", effects),
    ).resolves.toBe(false);
    expect(effects.setAuthState).not.toHaveBeenCalled();
  });

  it("publishes malformed input and clears only a matching transaction", async () => {
    const effects = deps();
    await handleDesktopCallbackUrl(
      "proliferate://auth/callback?state=state-1",
      effects,
    );
    expect(h.clearPendingGitHubAuth).toHaveBeenCalledWith(
      "state-1",
      expect.any(Error),
      expect.any(Object),
    );
    expect(effects.setAuthState).toHaveBeenCalledWith({
      issue: { kind: "callback_failed", reason: "malformed_callback" },
    });
  });

  it("does not clear a valid transaction when malformed input has no state", async () => {
    const effects = deps();
    await handleDesktopCallbackUrl(
      "proliferate://auth/callback?code=code-1",
      effects,
    );
    expect(h.clearPendingGitHubAuth).not.toHaveBeenCalled();
    expect(effects.setAuthState).toHaveBeenCalledWith({
      issue: { kind: "callback_failed", reason: "malformed_callback" },
    });
  });

  it("preserves a different valid transaction on state mismatch", async () => {
    const effects = deps();
    await handleDesktopCallbackUrl(
      "proliferate://auth/callback?code=code-1&state=other-state",
      effects,
    );
    expect(h.clearPendingGitHubAuth).not.toHaveBeenCalled();
    expect(h.exchangeDesktopAuthCode).not.toHaveBeenCalled();
    expect(effects.setAuthState).toHaveBeenCalledWith({
      issue: { kind: "callback_failed", reason: "state_mismatch" },
    });
  });

  it("expires and clears a transaction without exchanging", async () => {
    h.pending = pending({ created_at: "2000-01-01T00:00:00.000Z" });
    const effects = deps();
    await handleDesktopCallbackUrl(
      "proliferate://auth/callback?code=code-1&state=state-1",
      effects,
    );
    expect(h.clearPendingGitHubAuth).toHaveBeenCalledWith(
      "state-1",
      expect.any(Error),
      expect.any(Object),
    );
    expect(h.exchangeDesktopAuthCode).not.toHaveBeenCalled();
    expect(effects.setAuthState).toHaveBeenCalledWith({
      issue: { kind: "callback_failed", reason: "expired" },
    });
  });

  it("treats a provider failure as terminal and exposes its safe code", async () => {
    const effects = deps();
    await handleDesktopCallbackUrl(
      "proliferate://auth/callback?error=access_denied&state=state-1",
      effects,
    );
    expect(h.clearPendingGitHubAuth).toHaveBeenCalledWith(
      "state-1",
      expect.any(Error),
      expect.any(Object),
    );
    expect(h.exchangeDesktopAuthCode).not.toHaveBeenCalled();
    expect(effects.setAuthState).toHaveBeenCalledWith({
      issue: {
        kind: "callback_failed",
        reason: "provider_error",
        providerCode: "access_denied",
      },
    });
  });

  it("single-flights duplicate callbacks and commits a recovered session once", async () => {
    let resolveExchange!: (session: typeof SESSION) => void;
    h.exchangeDesktopAuthCode.mockReturnValue(
      new Promise((resolve) => {
        resolveExchange = resolve;
      }),
    );
    const effects = deps();
    const url = "proliferate://auth/callback?code=code-1&state=state-1";
    const first = handleDesktopCallbackUrl(url, effects);
    const duplicate = handleDesktopCallbackUrl(url, effects);

    resolveExchange(SESSION);
    await expect(Promise.all([first, duplicate])).resolves.toEqual([true, true]);
    expect(h.exchangeDesktopAuthCode).toHaveBeenCalledTimes(1);
    expect(h.clearPendingGitHubAuth).toHaveBeenCalledTimes(1);
    expect(h.applyAuthenticatedState).toHaveBeenCalledTimes(1);

    await handleDesktopCallbackUrl(url, effects);
    expect(h.exchangeDesktopAuthCode).toHaveBeenCalledTimes(1);
    expect(effects.setAuthState).toHaveBeenLastCalledWith({
      issue: { kind: "callback_failed", reason: "already_consumed" },
    });
  });

  it("does not let a malformed callback clear the transaction claimed by an exchange", async () => {
    let resolveExchange!: (session: typeof SESSION) => void;
    h.exchangeDesktopAuthCode.mockReturnValue(
      new Promise((resolve) => {
        resolveExchange = resolve;
      }),
    );
    const effects = deps();
    const valid = handleDesktopCallbackUrl(
      "proliferate://auth/callback?code=code-1&state=state-1",
      effects,
    );

    await expect(handleDesktopCallbackUrl(
      "proliferate://auth/callback?state=state-1",
      effects,
    )).resolves.toBe(true);

    expect(h.clearPendingGitHubAuth).not.toHaveBeenCalled();
    expect(effects.setAuthState).toHaveBeenLastCalledWith({
      issue: { kind: "callback_failed", reason: "already_consumed" },
    });

    resolveExchange(SESSION);
    await expect(valid).resolves.toBe(true);
    expect(h.exchangeDesktopAuthCode).toHaveBeenCalledTimes(1);
    expect(h.applyAuthenticatedState).toHaveBeenCalledTimes(1);
  });

  it("lets the active provider flow own the one session commit", async () => {
    h.activeSignIn = { state: "state-1" };
    const effects = deps();
    await handleDesktopCallbackUrl(
      "proliferate://auth/callback?code=code-1&state=state-1",
      effects,
    );
    expect(h.resolveGitHubSignIn).toHaveBeenCalledWith("state-1", SESSION);
    expect(h.applyAuthenticatedState).not.toHaveBeenCalled();
  });

  it("treats a persisted handled marker after reload/back as consumed", async () => {
    const url = "proliferate://auth/callback?code=code-1&state=state-1";
    h.pending = pending({ last_handled_callback_url: url });
    const effects = deps();

    await expect(handleDesktopCallbackUrl(url, effects)).resolves.toBe(true);
    expect(h.exchangeDesktopAuthCode).not.toHaveBeenCalled();
    expect(h.applyAuthenticatedState).not.toHaveBeenCalled();
    expect(h.clearPendingGitHubAuth).toHaveBeenCalledWith(
      "state-1",
      undefined,
      expect.any(Object),
    );
    expect(effects.setAuthState).toHaveBeenCalledWith({
      issue: { kind: "callback_failed", reason: "already_consumed" },
    });
  });

  it("clears a failed exchange before reporting and never retries it", async () => {
    h.activeSignIn = { state: "state-1" };
    h.exchangeDesktopAuthCode.mockRejectedValue(new Error("exchange failed"));
    h.captureTelemetryException.mockImplementation(() => {
      throw new Error("telemetry unavailable");
    });
    const effects = deps();
    const url = "proliferate://auth/callback?code=code-1&state=state-1";

    await expect(handleDesktopCallbackUrl(url, effects)).resolves.toBe(false);
    expect(h.clearPendingGitHubAuth).toHaveBeenCalledTimes(1);
    expect(h.rejectGitHubSignIn).toHaveBeenCalledTimes(1);
    expect(effects.setAuthState).toHaveBeenCalledWith({
      issue: { kind: "callback_failed", reason: "exchange_failed" },
    });

    await handleDesktopCallbackUrl(url, effects);
    expect(h.exchangeDesktopAuthCode).toHaveBeenCalledTimes(1);
  });

  it("does not let an old callback claim the replacement cancellation gap", async () => {
    const effects = deps();
    const replacement = beginDesktopAuthTransaction();

    await expect(handleDesktopCallbackUrl(
      "proliferate://auth/callback?code=old-code&state=state-1",
      effects,
    )).resolves.toBe(true);

    expect(h.exchangeDesktopAuthCode).not.toHaveBeenCalled();
    expect(h.clearPendingGitHubAuth).not.toHaveBeenCalled();
    expect(effects.setAuthState).not.toHaveBeenCalled();

    h.pending = pending({ state: "state-2", code_verifier: "verifier-2" });
    expect(registerDesktopAuthPendingState(replacement, h.pending.state)).toBe(true);
    await expect(handleDesktopCallbackUrl(
      "proliferate://auth/callback?code=new-code&state=state-2",
      effects,
    )).resolves.toBe(true);

    expect(h.exchangeDesktopAuthCode).toHaveBeenCalledTimes(1);
    expect(h.exchangeDesktopAuthCode).toHaveBeenCalledWith(
      "new-code",
      "verifier-2",
    );
    expect(h.applyAuthenticatedState).toHaveBeenCalledTimes(1);
  });

  it("silences a consumed callback when replacement has no pending record yet", async () => {
    const effects = deps();
    beginDesktopAuthTransaction();
    h.pending = null;

    await expect(handleDesktopCallbackUrl(
      "proliferate://auth/callback?code=old-code&state=state-1",
      effects,
    )).resolves.toBe(true);

    expect(h.exchangeDesktopAuthCode).not.toHaveBeenCalled();
    expect(h.clearPendingGitHubAuth).not.toHaveBeenCalled();
    expect(effects.setAuthState).not.toHaveBeenCalled();
    expect(effects.showToast).not.toHaveBeenCalled();
  });

  it("silences a malformed callback during the replacement registration gap", async () => {
    const effects = deps();
    beginDesktopAuthTransaction();
    h.pending = null;

    await expect(handleDesktopCallbackUrl(
      "proliferate://auth/callback?state=state-1",
      effects,
    )).resolves.toBe(true);

    expect(h.clearPendingGitHubAuth).not.toHaveBeenCalled();
    expect(effects.setAuthState).not.toHaveBeenCalled();
    expect(effects.showToast).not.toHaveBeenCalled();
  });

  it("detaches a replaced exchange so the new callback can complete first", async () => {
    let resolveOldExchange!: (session: typeof SESSION) => void;
    h.exchangeDesktopAuthCode
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveOldExchange = resolve;
      }))
      .mockResolvedValueOnce({ ...SESSION, access_token: "new-access" });
    const effects = deps();

    const oldCallback = handleDesktopCallbackUrl(
      "proliferate://auth/callback?code=old-code&state=state-1",
      effects,
    );
    await vi.waitFor(() => expect(h.exchangeDesktopAuthCode).toHaveBeenCalledTimes(1));

    // ProductHost does this synchronously before cancelling the old flow.
    const replacement = beginDesktopAuthTransaction();
    h.pending = pending({ state: "state-2", code_verifier: "verifier-2" });
    registerDesktopAuthPendingState(replacement, h.pending.state);
    const newCallback = handleDesktopCallbackUrl(
      "proliferate://auth/callback?code=new-code&state=state-2",
      effects,
    );

    await expect(newCallback).resolves.toBe(true);
    expect(h.exchangeDesktopAuthCode).toHaveBeenCalledTimes(2);
    expect(h.applyAuthenticatedState).toHaveBeenCalledTimes(1);
    expect(h.applyAuthenticatedState).toHaveBeenCalledWith(
      effects,
      expect.objectContaining({ access_token: "new-access" }),
      expect.objectContaining({ generation: replacement.generation }),
    );

    resolveOldExchange(SESSION);
    await expect(oldCallback).resolves.toBe(true);
    expect(h.applyAuthenticatedState).toHaveBeenCalledTimes(1);
    expect(effects.setAuthState).not.toHaveBeenCalledWith({
      issue: expect.anything(),
    });
  });

  it("silences a replaced exchange rejection without clearing or reporting the new attempt", async () => {
    let rejectOldExchange!: (error: Error) => void;
    h.exchangeDesktopAuthCode.mockReturnValueOnce(new Promise((_resolve, reject) => {
      rejectOldExchange = reject;
    }));
    const effects = deps();
    const oldCallback = handleDesktopCallbackUrl(
      "proliferate://auth/callback?code=old-code&state=state-1",
      effects,
    );
    await vi.waitFor(() => expect(h.exchangeDesktopAuthCode).toHaveBeenCalledTimes(1));

    beginDesktopAuthTransaction();
    h.pending = pending({ state: "state-2", code_verifier: "verifier-2" });
    vi.clearAllMocks();
    h.getStoredPendingAuthSession.mockImplementation(async () => h.pending);
    h.clearPendingGitHubAuth.mockResolvedValue(true);
    h.markPendingCallbackUrl.mockResolvedValue(true);

    rejectOldExchange(new Error("old exchange failed"));
    await expect(oldCallback).resolves.toBe(true);

    expect(h.clearPendingGitHubAuth).not.toHaveBeenCalled();
    expect(h.applyAuthenticatedState).not.toHaveBeenCalled();
    expect(h.captureTelemetryException).not.toHaveBeenCalled();
    expect(effects.setAuthState).not.toHaveBeenCalled();
  });
});
