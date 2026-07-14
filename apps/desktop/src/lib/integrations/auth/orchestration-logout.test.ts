import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredPendingAuthSession } from "@/lib/access/tauri/auth";
import type { AuthClientState } from "@/lib/domain/auth/auth-state-mapping";
import type { AuthOrchestrationDeps } from "./orchestration-effects";

const h = vi.hoisted(() => ({
  pending: null as StoredPendingAuthSession | null,
  revokeDesktopWorkerServerSide: vi.fn(),
  clearStoredPendingAuthSession: vi.fn(),
  getStoredPendingAuthSession: vi.fn(),
  cancelGitHubSignIn: vi.fn(),
}));

vi.mock("@/lib/access/tauri/auth", () => ({
  clearStoredAuthSession: vi.fn(),
  clearStoredPendingAuthSession: h.clearStoredPendingAuthSession,
  getStoredAuthSession: vi.fn(),
  getStoredPendingAuthSession: h.getStoredPendingAuthSession,
  setStoredAuthSession: vi.fn(),
  setStoredPendingAuthSession: vi.fn(),
}));
vi.mock("@/lib/domain/auth/github-signin-state", () => ({
  cancelGitHubSignIn: h.cancelGitHubSignIn,
}));
vi.mock("@/lib/domain/auth/auth-mode", () => ({
  isDevAuthBypassed: () => false,
}));
vi.mock("@/lib/integrations/auth/desktop-worker-revocation", () => ({
  revokeDesktopWorkerServerSide: h.revokeDesktopWorkerServerSide,
}));

import {
  registerDesktopAuthPendingState,
  replaceDesktopAuthTransaction,
} from "./desktop-auth-transaction";
import { signOut } from "./orchestration-provider-flow";

function pending(state: string): StoredPendingAuthSession {
  return {
    provider: "github",
    purpose: "login",
    state,
    code_verifier: `verifier-${state}`,
    redirect_uri: "proliferate://auth/callback",
    created_at: new Date().toISOString(),
    last_handled_callback_url: null,
  };
}

function createDeps(): {
  deps: AuthOrchestrationDeps;
  getState: () => AuthClientState;
} {
  let state: AuthClientState = {
    status: "authenticated",
    session: {
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_at: "2099-01-01T00:00:00.000Z",
      user_id: "user-1",
      email: "ada@example.test",
      display_name: "Ada",
    },
    user: null,
    error: null,
    issue: null,
  };
  return {
    deps: {
      getAuthState: () => state,
      setAuthState: (patch) => {
        state = { ...state, ...patch };
      },
      clearSessionRuntimeState: vi.fn(),
      closeRepoSetupModal: vi.fn(),
      showToast: vi.fn(),
    },
    getState: () => state,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.pending = null;
  h.getStoredPendingAuthSession.mockImplementation(async () => h.pending);
  h.clearStoredPendingAuthSession.mockImplementation(async () => {
    h.pending = null;
  });
});

describe("signOut transaction ownership", () => {
  it("cannot clear or anonymize a replacement login after worker revoke", async () => {
    const revoke = deferred<void>();
    h.revokeDesktopWorkerServerSide.mockReturnValue(revoke.promise);
    const { deps, getState } = createDeps();
    const logoutTransaction = replaceDesktopAuthTransaction();

    const staleLogout = signOut(deps, logoutTransaction);
    await vi.waitFor(() => {
      expect(h.revokeDesktopWorkerServerSide).toHaveBeenCalledOnce();
    });

    const loginTransaction = replaceDesktopAuthTransaction();
    h.pending = pending("state-new");
    expect(registerDesktopAuthPendingState(
      loginTransaction,
      "state-new",
    )).toBe(true);
    revoke.resolve();

    await expect(staleLogout).rejects.toMatchObject({ name: "AbortError" });
    expect(h.pending?.state).toBe("state-new");
    expect(h.clearStoredPendingAuthSession).not.toHaveBeenCalled();
    expect(h.cancelGitHubSignIn).not.toHaveBeenCalled();
    expect(getState().status).toBe("authenticated");
    expect(deps.clearSessionRuntimeState).not.toHaveBeenCalled();
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
