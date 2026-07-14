// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  productHostWrapper,
  makeTestProductHost,
} from "@/test/product-host-test-utils";
import { useOrgSlugSsoSignIn } from "./use-org-slug-sso-sign-in";

// The generic answer the host raises for a slug that does not resolve to
// enabled SSO (missing org / no SSO / disabled all collapse to one message).
const SLUG_UNAVAILABLE =
  "We could not find single sign-on for that workspace. Check the sign-in link your admin shared.";

function harness(startLogin: (request: unknown) => Promise<void>) {
  const host = makeTestProductHost({
    auth: { startLogin: startLogin as never },
  });
  return renderHook(() => useOrgSlugSsoSignIn(), {
    wrapper: productHostWrapper(host),
  });
}

afterEach(() => {
  cleanup();
});

describe("useOrgSlugSsoSignIn", () => {
  it("resolves the slug and starts SSO for an enabled org connection", async () => {
    const startLogin = vi.fn(async () => {});
    const { result } = harness(startLogin);
    let outcome = false;
    await act(async () => {
      outcome = await result.current.signIn("  acme  ");
    });

    expect(outcome).toBe(true);
    // The host owns slug discovery + connection resolution; the hook only hands
    // it the trimmed slug.
    expect(startLogin).toHaveBeenCalledWith({ kind: "sso", slug: "acme" });
    expect(result.current.error).toBeNull();
  });

  it("surfaces a generic error and does not resolve when the slug is unavailable", async () => {
    const startLogin = vi.fn(async () => {
      throw new Error(SLUG_UNAVAILABLE);
    });
    const { result } = harness(startLogin);
    let outcome = true;
    await act(async () => {
      outcome = await result.current.signIn("ghost-org");
    });

    expect(outcome).toBe(false);
    expect(result.current.error).toContain("sign-in link your admin shared");
  });

  it("rejects an empty slug before delegating to the host", async () => {
    const startLogin = vi.fn(async () => {});
    const { result } = harness(startLogin);
    let outcome = true;
    await act(async () => {
      outcome = await result.current.signIn("   ");
    });

    expect(outcome).toBe(false);
    expect(startLogin).not.toHaveBeenCalled();
    expect(result.current.error).toBeTruthy();
  });
});
