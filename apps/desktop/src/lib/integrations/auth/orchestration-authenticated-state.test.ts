import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredAuthSession } from "@/lib/domain/auth/stored-auth-session";
import type { AuthOrchestrationDeps } from "./orchestration-effects";

const h = vi.hoisted(() => ({
  stored: null as StoredAuthSession | null,
  getStoredAuthSession: vi.fn(),
  setStoredAuthSession: vi.fn(),
  clearStoredAuthSession: vi.fn(),
}));

vi.mock("@/lib/access/tauri/auth", () => ({
  clearStoredAuthSession: h.clearStoredAuthSession,
  clearStoredPendingAuthSession: vi.fn(),
  getStoredAuthSession: h.getStoredAuthSession,
  getStoredPendingAuthSession: vi.fn(),
  setStoredAuthSession: h.setStoredAuthSession,
  setStoredPendingAuthSession: vi.fn(),
}));
vi.mock("@/lib/domain/auth/github-signin-state", () => ({
  cancelGitHubSignIn: vi.fn(),
}));

import { replaceDesktopAuthTransaction } from "./desktop-auth-transaction";
import { applyAuthenticatedState } from "./orchestration-effects";

const PRIOR_SESSION: StoredAuthSession = {
  access_token: "prior-access",
  refresh_token: "prior-refresh",
  expires_at: "2099-01-01T00:00:00Z",
  user_id: "user-1",
  email: "user@example.test",
  display_name: "Prior",
};
const STALE_SESSION: StoredAuthSession = {
  ...PRIOR_SESSION,
  access_token: "stale-access",
  refresh_token: "stale-refresh",
};
const CURRENT_SESSION: StoredAuthSession = {
  ...PRIOR_SESSION,
  access_token: "current-access",
  refresh_token: "current-refresh",
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function deps(): AuthOrchestrationDeps {
  return {
    getAuthState: vi.fn(),
    setAuthState: vi.fn(),
    clearSessionRuntimeState: vi.fn(),
    closeRepoSetupModal: vi.fn(),
    showToast: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.stored = PRIOR_SESSION;
  h.getStoredAuthSession.mockImplementation(async () => h.stored);
  h.setStoredAuthSession.mockImplementation(async (session) => {
    h.stored = session;
  });
  h.clearStoredAuthSession.mockImplementation(async () => {
    h.stored = null;
  });
});

describe("transaction-owned authenticated state", () => {
  it("restores prior credentials and never publishes a session replaced during persistence", async () => {
    const writeStarted = deferred();
    const releaseWrite = deferred();
    h.setStoredAuthSession.mockImplementationOnce(async (session) => {
      h.stored = session;
      writeStarted.resolve();
      await releaseWrite.promise;
    });
    const effects = deps();
    const staleTransaction = replaceDesktopAuthTransaction();

    const staleCommit = applyAuthenticatedState(
      effects,
      STALE_SESSION,
      staleTransaction,
    );
    await writeStarted.promise;
    const currentTransaction = replaceDesktopAuthTransaction();
    releaseWrite.resolve();

    await expect(staleCommit).resolves.toBe(false);
    expect(h.stored).toEqual(PRIOR_SESSION);
    expect(effects.setAuthState).not.toHaveBeenCalled();

    await expect(applyAuthenticatedState(
      effects,
      CURRENT_SESSION,
      currentTransaction,
    )).resolves.toBe(true);
    expect(h.stored).toEqual(CURRENT_SESSION);
    expect(effects.setAuthState).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "authenticated",
        session: CURRENT_SESSION,
      }),
    );
  });
});
