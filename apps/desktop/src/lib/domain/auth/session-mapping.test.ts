import { describe, expect, it } from "vitest";
import type { AuthUser } from "@/lib/domain/auth/auth-user";
import type { StoredAuthSession } from "@/lib/domain/auth/stored-auth-session";
import {
  authUserFromStoredSession,
  storedSessionWithValidatedUser,
} from "./session-mapping";

const storedSession: StoredAuthSession = {
  access_token: "access-token",
  refresh_token: "refresh-token",
  expires_at: "2026-05-09T12:00:00.000Z",
  user_id: "user-session",
  email: "session@example.com",
  display_name: "Session User",
};

describe("authUserFromStoredSession", () => {
  it("maps persisted session identity into the auth user model", () => {
    expect(authUserFromStoredSession(storedSession)).toEqual({
      id: "user-session",
      email: "session@example.com",
      display_name: "Session User",
      github_login: null,
      avatar_url: null,
    });
  });
});

describe("storedSessionWithValidatedUser", () => {
  it("keeps tokens while replacing stale persisted identity fields", () => {
    const user: AuthUser = {
      id: "user-current",
      email: "current@example.com",
      display_name: null,
      github_login: "current-login",
      avatar_url: "https://example.com/avatar.png",
    };

    expect(storedSessionWithValidatedUser(storedSession, user)).toEqual({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_at: "2026-05-09T12:00:00.000Z",
      user_id: "user-current",
      email: "current@example.com",
      display_name: null,
      github_login: "current-login",
      avatar_url: "https://example.com/avatar.png",
    });
  });
});
