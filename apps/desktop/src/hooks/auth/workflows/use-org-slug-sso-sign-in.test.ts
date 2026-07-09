// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signInWithSso: vi.fn(async () => ({ provider: "sso", source: "browser" })),
  discoverDesktopSso: vi.fn(),
}));

vi.mock("@/hooks/auth/workflows/use-auth-actions", () => ({
  useAuthActions: () => ({ signInWithSso: mocks.signInWithSso }),
}));

vi.mock("@/lib/integrations/auth/proliferate-sso-auth", () => ({
  discoverDesktopSso: mocks.discoverDesktopSso,
}));

import { useOrgSlugSsoSignIn } from "./use-org-slug-sso-sign-in";

afterEach(() => {
  cleanup();
  mocks.signInWithSso.mockClear();
  mocks.discoverDesktopSso.mockReset();
});

describe("useOrgSlugSsoSignIn", () => {
  it("resolves the slug and starts SSO for an enabled org connection", async () => {
    mocks.discoverDesktopSso.mockResolvedValue({
      enabled: true,
      scope: "organization",
      organizationId: "org-123",
      connectionId: "conn-456",
      protocol: "oidc",
      displayName: "Okta",
      reason: null,
    });

    const { result } = renderHook(() => useOrgSlugSsoSignIn());
    let outcome = false;
    await act(async () => {
      outcome = await result.current.signIn("  acme  ");
    });

    expect(outcome).toBe(true);
    expect(mocks.discoverDesktopSso).toHaveBeenCalledWith({ slug: "acme" });
    expect(mocks.signInWithSso).toHaveBeenCalledWith({
      organizationId: "org-123",
      connectionId: "conn-456",
      prompt: "select_account",
    });
    expect(result.current.error).toBeNull();
  });

  it("surfaces a generic error and does not start SSO when the slug is unavailable", async () => {
    mocks.discoverDesktopSso.mockResolvedValue({
      enabled: false,
      scope: null,
      organizationId: null,
      connectionId: null,
      protocol: null,
      displayName: null,
      reason: "not_available",
    });

    const { result } = renderHook(() => useOrgSlugSsoSignIn());
    let outcome = true;
    await act(async () => {
      outcome = await result.current.signIn("ghost-org");
    });

    expect(outcome).toBe(false);
    expect(mocks.signInWithSso).not.toHaveBeenCalled();
    expect(result.current.error).toContain("sign-in link your admin shared");
  });

  it("rejects an empty slug before hitting the network", async () => {
    const { result } = renderHook(() => useOrgSlugSsoSignIn());
    let outcome = true;
    await act(async () => {
      outcome = await result.current.signIn("   ");
    });

    expect(outcome).toBe(false);
    expect(mocks.discoverDesktopSso).not.toHaveBeenCalled();
    expect(result.current.error).toBeTruthy();
  });
});
