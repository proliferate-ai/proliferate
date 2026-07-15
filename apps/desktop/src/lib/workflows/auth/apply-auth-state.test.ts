import { describe, expect, it, vi } from "vitest";
import type { AuthClientStatePatch } from "@/lib/domain/auth/auth-state-mapping";
import type { StoredAuthSession } from "@/lib/domain/auth/stored-auth-session";
import {
  applyAnonymousAuthState,
  applyPersistedAuthenticatedAuthState,
  applyVolatileAuthenticatedAuthState,
} from "./apply-auth-state";

const storedSession: StoredAuthSession = {
  access_token: "access-token",
  refresh_token: "refresh-token",
  expires_at: "2026-05-09T12:00:00.000Z",
  user_id: "user-session",
  email: "session@example.com",
  display_name: "Session User",
};

describe("applyAnonymousAuthState", () => {
  it("clears persisted auth before resetting runtime and client auth state", async () => {
    const calls: string[] = [];
    const setAuthState = vi.fn((_: AuthClientStatePatch) => calls.push("setAuthState"));

    await applyAnonymousAuthState({ clearPendingAuth: true }, {
      clearStoredAuthSession: vi.fn(async () => {
        calls.push("clearStoredAuthSession");
      }),
      clearStoredPendingAuthSession: vi.fn(async () => {
        calls.push("clearStoredPendingAuthSession");
      }),
      clearSessionRuntimeState: vi.fn(() => {
        calls.push("clearSessionRuntimeState");
      }),
      closeRepoSetupModal: vi.fn(() => {
        calls.push("closeRepoSetupModal");
      }),
      setAuthState,
    });

    expect(calls).toEqual([
      "clearStoredAuthSession",
      "clearStoredPendingAuthSession",
      "clearSessionRuntimeState",
      "closeRepoSetupModal",
      "setAuthState",
    ]);
    expect(setAuthState).toHaveBeenCalledWith({
      status: "anonymous",
      session: null,
      user: null,
      error: null,
      issue: null,
    });
  });
});

describe("applyPersistedAuthenticatedAuthState", () => {
  it("persists the session before applying authenticated client state", async () => {
    const calls: string[] = [];
    const setAuthState = vi.fn((_: AuthClientStatePatch) => calls.push("setAuthState"));

    await applyPersistedAuthenticatedAuthState({ session: storedSession }, {
      setStoredAuthSession: vi.fn(async () => {
        calls.push("setStoredAuthSession");
      }),
      setAuthState,
    });

    expect(calls).toEqual(["setStoredAuthSession", "setAuthState"]);
    expect(setAuthState).toHaveBeenCalledWith({
      status: "authenticated",
      session: storedSession,
      user: {
        id: "user-session",
        email: "session@example.com",
        display_name: "Session User",
        github_login: null,
        avatar_url: null,
      },
      error: null,
      issue: null,
    });
  });
});

describe("applyVolatileAuthenticatedAuthState", () => {
  it("applies cached authenticated state without requiring persistence deps", () => {
    const setAuthState = vi.fn();

    applyVolatileAuthenticatedAuthState({ session: storedSession }, { setAuthState });

    expect(setAuthState).toHaveBeenCalledWith({
      status: "authenticated",
      session: storedSession,
      user: {
        id: "user-session",
        email: "session@example.com",
        display_name: "Session User",
        github_login: null,
        avatar_url: null,
      },
      error: null,
      issue: null,
    });
  });
});
