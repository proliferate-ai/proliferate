import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthOrchestrationDeps } from "@/lib/integrations/auth/orchestration-effects";

const m = vi.hoisted(() => ({
  isDevAuthBypassed: vi.fn(() => false),
  getProliferateApiBaseUrl: vi.fn(() => "http://api.test"),
  checkControlPlaneReachable: vi.fn(async () => false),
  signInWithDesktopPassword: vi.fn(async () => ({
    access_token: "a",
    refresh_token: "r",
  })),
}));

vi.mock("@proliferate/product-client/internal/lib/domain/auth/auth-mode", () => ({
  isDevAuthBypassed: m.isDevAuthBypassed,
}));
vi.mock("@/lib/infra/proliferate-api", () => ({
  getProliferateApiBaseUrl: m.getProliferateApiBaseUrl,
}));
vi.mock("@proliferate/product-client/internal/lib/access/cloud/health", () => ({
  checkControlPlaneReachable: m.checkControlPlaneReachable,
}));
vi.mock("@/lib/integrations/auth/proliferate-auth-password", () => ({
  signInWithDesktopPassword: m.signInWithDesktopPassword,
}));
// Keep the real clearPublishedAuthIssue/toError, exactly what this test
// exercises, and only stub the heavier full-state-replacement effects.
vi.mock("./orchestration-effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./orchestration-effects")>();
  return {
    ...actual,
    applyAuthenticatedState: vi.fn(),
    applyDevBypassState: vi.fn(),
  };
});

import { signInWithPassword } from "@/lib/integrations/auth/orchestration-password-flow";

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
    closeRepoSetupModal: vi.fn(),
    showToast: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.isDevAuthBypassed.mockReturnValue(false);
  m.checkControlPlaneReachable.mockResolvedValue(false);
});

describe("signInWithPassword clears a stale published issue on retry", () => {
  it("clears the issue as its first state write, before the reachability check settles", async () => {
    const deps = makeDeps();

    await expect(
      signInWithPassword({ email: "a@example.com", password: "hunter2" }, deps),
    ).rejects.toThrow("Signing in requires a reachable control plane.");

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

    await expect(
      signInWithPassword({ email: "a@example.com", password: "hunter2" }, deps),
    ).rejects.toThrow();

    expect(deps.setAuthState).not.toHaveBeenCalled();
  });
});
