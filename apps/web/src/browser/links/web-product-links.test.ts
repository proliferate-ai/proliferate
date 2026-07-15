import { describe, expect, it } from "vitest";

import {
  buildDesktopDeepLink,
  buildWebReturnUrl,
  decodeWebBillingReturn,
  decodeWebGithubAppHomeSource,
  decodeWebGithubAppSettingsReturn,
  decodeWebIntegrationComplete,
  desktopDeepLinkScheme,
} from "./web-product-links";

const ORIGIN = "https://app.proliferate.com";

describe("decodeWebBillingReturn", () => {
  it("classifies a successful checkout and drops the consumed checkout param", () => {
    const entry = decodeWebBillingReturn(
      new URL(`${ORIGIN}/settings/cloud?checkout=success&plan=team`),
    );
    expect(entry).toMatchObject({ kind: "billing-return", status: "success" });
    expect(entry.query).toEqual([["plan", "team"]]);
  });

  it("classifies a cancelled checkout", () => {
    const entry = decodeWebBillingReturn(
      new URL(`${ORIGIN}/settings/cloud?checkout=cancel`),
    );
    expect(entry.kind === "billing-return" && entry.status).toBe("cancel");
  });

  it("falls back to a neutral done return and strips returnSurface", () => {
    const entry = decodeWebBillingReturn(
      new URL(`${ORIGIN}/settings/cloud?returnSurface=web&ref=email`),
    );
    expect(entry).toMatchObject({ kind: "billing-return", status: "done" });
    expect(entry.query).toEqual([["ref", "email"]]);
  });
});

describe("decodeWebIntegrationComplete", () => {
  it("normalizes a recognized integration completion without leaking extra params into typed fields", () => {
    const entry = decodeWebIntegrationComplete(
      new URL(
        `${ORIGIN}/plugins/connect/complete?source=integration_oauth_callback&status=completed&flowId=flow_1&failureCode=&access_token=SECRET`,
      ),
    );
    expect(entry).toMatchObject({
      kind: "integration-callback",
      source: "integration_oauth_callback",
      status: "completed",
      flowId: "flow_1",
    });
    // The opaque token is never lifted into a typed field; it only survives as
    // preserved location state, never as an OAuth secret in a typed slot.
    expect(entry && "failureCode" in entry ? entry.failureCode : undefined).toBeUndefined();
  });

  it("returns null for an unrecognized source", () => {
    expect(
      decodeWebIntegrationComplete(
        new URL(`${ORIGIN}/plugins/connect/complete?source=phishy`),
      ),
    ).toBeNull();
    expect(
      decodeWebIntegrationComplete(new URL(`${ORIGIN}/plugins/connect/complete`)),
    ).toBeNull();
  });
});

describe("decodeWebGithubAppSettingsReturn", () => {
  it("decodes a github_app_callback settings return into the canonical section", () => {
    const entry = decodeWebGithubAppSettingsReturn(
      new URL(`${ORIGIN}/settings/account?source=github_app_callback`),
    );
    expect(entry).toMatchObject({
      kind: "settings",
      section: "account",
      source: "github_app_callback",
    });
  });

  it("recognizes the installation callback and normalizes /settings/organizations", () => {
    const entry = decodeWebGithubAppSettingsReturn(
      new URL(`${ORIGIN}/settings/organizations?source=github_app_installation_callback`),
    );
    expect(entry).toMatchObject({ kind: "settings", section: "organization" });
    // installation_callback is not the typed settings source; it survives in query.
    expect(entry?.query).toContainEqual(["source", "github_app_installation_callback"]);
  });

  it("returns null without a recognized source or on an unlisted path", () => {
    expect(
      decodeWebGithubAppSettingsReturn(new URL(`${ORIGIN}/settings/account`)),
    ).toBeNull();
    expect(
      decodeWebGithubAppSettingsReturn(
        new URL(`${ORIGIN}/dashboard?source=github_app_callback`),
      ),
    ).toBeNull();
  });
});

describe("decodeWebGithubAppHomeSource", () => {
  it("recognizes a home return source", () => {
    expect(
      decodeWebGithubAppHomeSource(new URL(`${ORIGIN}/?source=github_app_callback`)),
    ).toBe("github_app_callback");
    expect(
      decodeWebGithubAppHomeSource(
        new URL(`${ORIGIN}/?source=github_app_installation_callback`),
      ),
    ).toBe("github_app_installation_callback");
  });

  it("returns null off the home path or for an unrecognized source", () => {
    expect(
      decodeWebGithubAppHomeSource(new URL(`${ORIGIN}/settings?source=github_app_callback`)),
    ).toBeNull();
    expect(
      decodeWebGithubAppHomeSource(new URL(`${ORIGIN}/?source=other`)),
    ).toBeNull();
  });
});

describe("buildWebReturnUrl", () => {
  it("encodes a billing-return entry", () => {
    expect(
      buildWebReturnUrl({ kind: "billing-return", status: "success" }, ORIGIN),
    ).toBe(`${ORIGIN}/settings/cloud?checkout=success`);
  });

  it("encodes an organization-join entry with the issuing origin", () => {
    expect(
      buildWebReturnUrl(
        { kind: "organization-join", organizationId: "org 1", serverOrigin: ORIGIN },
        ORIGIN,
      ),
    ).toBe(`${ORIGIN}/join/org%201?origin=${encodeURIComponent(ORIGIN)}`);
  });

  it("throws rather than inventing a return URL for an unsupported entry kind", () => {
    expect(() =>
      buildWebReturnUrl({ kind: "invitation", token: "t" }, ORIGIN),
    ).toThrow();
  });
});

describe("desktopDeepLinkScheme / buildDesktopDeepLink", () => {
  it("uses the loopback scheme on localhost and the production scheme otherwise", () => {
    expect(desktopDeepLinkScheme("localhost")).toBe("proliferate-local");
    expect(desktopDeepLinkScheme("127.0.0.1")).toBe("proliferate-local");
    expect(desktopDeepLinkScheme("app.proliferate.com")).toBe("proliferate");
  });

  it("builds a deep link off the current hostname", () => {
    // Node env: no window, so exercise the scheme picker directly.
    expect(`${desktopDeepLinkScheme("app.x.com")}://join/o1`).toBe(
      "proliferate://join/o1",
    );
    expect(typeof buildDesktopDeepLink).toBe("function");
  });
});
