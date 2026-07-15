import { describe, expect, it } from "vitest";
import type { AuthUser } from "@/lib/domain/auth/auth-user";
import type { StoredAuthSession } from "@/lib/domain/auth/stored-auth-session";
import {
  anonymousAuthState,
  authenticatedAuthState,
  authErrorStatePatch,
  bootstrappingAuthStatePatch,
} from "./auth-state-mapping";

const storedSession: StoredAuthSession = {
  access_token: "access-token",
  refresh_token: "refresh-token",
  expires_at: "2026-05-09T12:00:00.000Z",
  user_id: "user-session",
  email: "session@example.com",
  display_name: "Session User",
  github_login: "session-login",
};

describe("auth state mapping", () => {
  it("builds bootstrapping and anonymous state without requiring store access", () => {
    expect(bootstrappingAuthStatePatch()).toEqual({
      status: "bootstrapping",
      error: null,
      issue: null,
    });

    expect(anonymousAuthState()).toEqual({
      status: "anonymous",
      session: null,
      user: null,
      error: null,
      issue: null,
    });
  });

  it("builds authenticated state from either the session or a validated user", () => {
    expect(authenticatedAuthState(storedSession).user).toEqual({
      id: "user-session",
      email: "session@example.com",
      display_name: "Session User",
      github_login: "session-login",
      avatar_url: null,
    });

    const validatedUser: AuthUser = {
      id: "user-current",
      email: "current@example.com",
      display_name: "Current User",
      github_login: null,
      avatar_url: null,
    };

    expect(authenticatedAuthState(storedSession, validatedUser)).toEqual({
      status: "authenticated",
      session: storedSession,
      user: validatedUser,
      error: null,
      issue: null,
    });
  });

  it("builds an error-only patch for background callback failures", () => {
    expect(authErrorStatePatch("Sign-in failed")).toEqual({
      error: "Sign-in failed",
    });
  });
});
