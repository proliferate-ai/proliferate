// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startLogin: vi.fn(async () => {}),
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({ auth: { startLogin: mocks.startLogin } }),
}));

import { useOrgSlugSsoSignIn } from "./use-org-slug-sso-sign-in";

afterEach(() => {
  cleanup();
  mocks.startLogin.mockReset();
  mocks.startLogin.mockResolvedValue(undefined);
});

describe("useOrgSlugSsoSignIn", () => {
  it("resolves the slug and starts SSO for an enabled org connection", async () => {
    const { result } = renderHook(() => useOrgSlugSsoSignIn());
    let outcome = false;
    await act(async () => {
      outcome = await result.current.signIn("  acme  ");
    });

    expect(outcome).toBe(true);
    expect(mocks.startLogin).toHaveBeenCalledWith({ kind: "sso", slug: "acme" });
    expect(result.current.error).toBeNull();
  });

  it("surfaces a generic error and does not start SSO when the slug is unavailable", async () => {
    mocks.startLogin.mockRejectedValue(new Error(
      "We could not find single sign-on for that workspace. Check the sign-in link your admin shared.",
    ));

    const { result } = renderHook(() => useOrgSlugSsoSignIn());
    let outcome = true;
    await act(async () => {
      outcome = await result.current.signIn("ghost-org");
    });

    expect(outcome).toBe(false);
    expect(mocks.startLogin).toHaveBeenCalledWith({ kind: "sso", slug: "ghost-org" });
    expect(result.current.error).toContain("sign-in link your admin shared");
  });

  it("rejects an empty slug before hitting the network", async () => {
    const { result } = renderHook(() => useOrgSlugSsoSignIn());
    let outcome = true;
    await act(async () => {
      outcome = await result.current.signIn("   ");
    });

    expect(outcome).toBe(false);
    expect(mocks.startLogin).not.toHaveBeenCalled();
    expect(result.current.error).toBeTruthy();
  });
});
