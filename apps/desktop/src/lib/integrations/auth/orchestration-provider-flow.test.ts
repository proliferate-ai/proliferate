import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthOrchestrationDeps } from "@/lib/integrations/auth/orchestration-effects";

const m = vi.hoisted(() => ({
  getStoredPendingAuthSession: vi.fn(),
  setStoredPendingAuthSession: vi.fn(async () => {}),
  clearStoredPendingAuthSession: vi.fn(async () => {}),
  getActiveGitHubSignIn: vi.fn(() => null as { state: string } | null),
  resolveGitHubSignIn: vi.fn(),
  startGitHubSignIn: vi.fn(() => ({
    state: "s1",
    abortController: new AbortController(),
    promise: new Promise(() => {}),
  })),
  cancelGitHubSignIn: vi.fn(),
  isDevAuthBypassed: vi.fn(() => false),
  createPendingGitHubDesktopAuth: vi.fn(() => ({
    state: "s1",
    code_verifier: "verifier",
    redirect_uri: "proliferate://auth/callback",
  })),
  isPendingDesktopAuthExpired: vi.fn(() => false),
  beginGitHubDesktopSignIn: vi.fn(async () => {}),
  beginDesktopProviderAuth: vi.fn(async () => {}),
  pollGitHubDesktopSession: vi.fn(() => new Promise(() => {})),
  abortError: vi.fn((message: string) => new Error(message)),
  getGitHubDesktopAuthAvailability: vi.fn(async () => ({ enabled: true })),
  getProliferateApiBaseUrl: vi.fn(() => "http://api.test"),
  checkControlPlaneReachable: vi.fn(async () => false),
  revokeDesktopWorkerServerSide: vi.fn(async () => {}),
}));

vi.mock("@/lib/access/tauri/auth", () => ({
  getStoredPendingAuthSession: m.getStoredPendingAuthSession,
  setStoredPendingAuthSession: m.setStoredPendingAuthSession,
  clearStoredPendingAuthSession: m.clearStoredPendingAuthSession,
}));
vi.mock("@proliferate/product-client/internal/lib/domain/auth/github-signin-state", () => ({
  getActiveGitHubSignIn: m.getActiveGitHubSignIn,
  resolveGitHubSignIn: m.resolveGitHubSignIn,
  startGitHubSignIn: m.startGitHubSignIn,
  cancelGitHubSignIn: m.cancelGitHubSignIn,
}));
vi.mock("@proliferate/product-client/internal/lib/domain/auth/auth-mode", () => ({
  isDevAuthBypassed: m.isDevAuthBypassed,
}));
vi.mock("@/lib/integrations/auth/proliferate-auth", () => ({
  abortError: m.abortError,
  AuthRequestError: class AuthRequestError extends Error {
    status: number;
    constructor(message: string, status = 0) {
      super(message);
      this.status = status;
    }
  },
  beginDesktopProviderAuth: m.beginDesktopProviderAuth,
  beginGitHubDesktopSignIn: m.beginGitHubDesktopSignIn,
  createPendingGitHubDesktopAuth: m.createPendingGitHubDesktopAuth,
  isPendingDesktopAuthExpired: m.isPendingDesktopAuthExpired,
  pollGitHubDesktopSession: m.pollGitHubDesktopSession,
}));
vi.mock("@proliferate/product-client/internal/lib/access/cloud/auth-probes", () => ({
  getGitHubDesktopAuthAvailability: m.getGitHubDesktopAuthAvailability,
}));
vi.mock("@/lib/infra/proliferate-api", () => ({
  getProliferateApiBaseUrl: m.getProliferateApiBaseUrl,
}));
vi.mock("@proliferate/product-client/internal/lib/access/cloud/health", () => ({
  checkControlPlaneReachable: m.checkControlPlaneReachable,
}));
vi.mock("@/lib/integrations/auth/desktop-worker-revocation", () => ({
  revokeDesktopWorkerServerSide: m.revokeDesktopWorkerServerSide,
}));
// Keep the real clearPublishedAuthIssue/clearPendingGitHubAuth/toError — those
// are exactly what these tests exercise — and only stub the heavier
// full-state-replacement effects that aren't relevant here.
vi.mock("./orchestration-effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./orchestration-effects")>();
  return {
    ...actual,
    applyAnonymousState: vi.fn(),
    applyAuthenticatedState: vi.fn(),
    applyDevBypassState: vi.fn(),
  };
});

import { cancelActiveAuthFlow, signInWithGitHub } from "@/lib/integrations/auth/orchestration-provider-flow";

function makeDeps(overrides: Partial<AuthOrchestrationDeps> = {}): AuthOrchestrationDeps {
  return {
    getAuthState: vi.fn(() => ({
      status: "anonymous" as const,
      session: null,
      user: null,
      error: null,
      issue: { kind: "callback_failed", reason: "exchange_failed" } as const,
    })),
    setAuthState: vi.fn(),
    clearSessionRuntimeState: vi.fn(),
    dismissRepoAddedReceipt: vi.fn(),
    showToast: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.isDevAuthBypassed.mockReturnValue(false);
  m.checkControlPlaneReachable.mockResolvedValue(false);
  m.getStoredPendingAuthSession.mockResolvedValue(null);
});

describe("signInWithGitHub clears a stale published issue on retry", () => {
  it("clears the issue as its first state write, before the reachability check settles", async () => {
    const deps = makeDeps();

    await expect(signInWithGitHub(undefined, deps)).rejects.toThrow(
      "GitHub sign-in requires a reachable control plane.",
    );

    const setAuthState = deps.setAuthState as ReturnType<typeof vi.fn>;
    expect(setAuthState).toHaveBeenCalledWith({ issue: null });
    expect(setAuthState.mock.calls[0][0]).toEqual({ issue: null });
  });

  it("does not publish the clear once already authenticated", async () => {
    const deps = makeDeps({
      getAuthState: vi.fn(() => ({
        status: "authenticated" as const,
        session: null,
        user: null,
        error: null,
        issue: null,
      })),
    });

    await expect(signInWithGitHub(undefined, deps)).rejects.toThrow();

    expect(deps.setAuthState).not.toHaveBeenCalled();
  });
});

describe("cancelActiveAuthFlow clears a stale published issue", () => {
  it("clears the pending session and the published issue together", async () => {
    const deps = makeDeps();

    await cancelActiveAuthFlow("Sign-in cancelled.", deps);

    expect(m.clearStoredPendingAuthSession).toHaveBeenCalled();
    expect(m.cancelGitHubSignIn).toHaveBeenCalled();
    expect(deps.setAuthState).toHaveBeenCalledWith({ issue: null });
  });

  it("does not publish the clear once already authenticated", async () => {
    const deps = makeDeps({
      getAuthState: vi.fn(() => ({
        status: "authenticated" as const,
        session: null,
        user: null,
        error: null,
        issue: null,
      })),
    });

    await cancelActiveAuthFlow("Sign-in cancelled.", deps);

    expect(deps.setAuthState).not.toHaveBeenCalled();
  });
});
