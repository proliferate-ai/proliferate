import { describe, expect, it } from "vitest";
import {
  buildAccountProviderViews,
  getAccountActionDescription,
  getAccountDisplayName,
  getAccountInitials,
  getGitHubStatusLabel,
} from "./account-profile-presentation";

describe("getAccountDisplayName", () => {
  it("prefers explicit display names, then GitHub login, then email prefix", () => {
    expect(
      getAccountDisplayName({
        email: "person@example.com",
        displayName: "  Person Name  ",
        githubLogin: "octocat",
        isAuthenticated: true,
        devAuthBypassed: false,
        localMode: false,
      }),
    ).toBe("Person Name");

    expect(
      getAccountDisplayName({
        email: "person@example.com",
        displayName: null,
        githubLogin: "octocat",
        isAuthenticated: true,
        devAuthBypassed: false,
        localMode: false,
      }),
    ).toBe("octocat");

    expect(
      getAccountDisplayName({
        email: "person@example.com",
        displayName: null,
        githubLogin: null,
        isAuthenticated: true,
        devAuthBypassed: false,
        localMode: false,
      }),
    ).toBe("person");
  });
});

describe("getGitHubStatusLabel", () => {
  it("explains missing GitHub state without implying a connected username", () => {
    expect(
      getGitHubStatusLabel({
        cloudSignInChecking: false,
        devAuthBypassed: false,
        localMode: false,
        signInUnavailable: false,
      }),
    ).toBe("Not connected");

    expect(
      getGitHubStatusLabel({
        cloudSignInChecking: false,
        devAuthBypassed: false,
        localMode: true,
        signInUnavailable: false,
      }),
    ).toBe("Unavailable");
  });
});

describe("getAccountActionDescription", () => {
  it("uses GitHub connection copy based on whether GitHub is linked", () => {
    expect(
      getAccountActionDescription({
        devAuthBypassed: false,
        isAuthenticated: true,
        localMode: false,
        signInUnavailable: false,
        signedInWhileCloudUnavailable: false,
        githubConnected: true,
      }),
    ).toContain("manage repository access");

    expect(
      getAccountActionDescription({
        devAuthBypassed: false,
        isAuthenticated: true,
        localMode: false,
        signInUnavailable: false,
        signedInWhileCloudUnavailable: false,
        githubConnected: false,
      }),
    ).toContain("Connect GitHub");
  });
});

describe("getAccountInitials", () => {
  it("builds stable initials for avatars", () => {
    expect(getAccountInitials("Person Name")).toBe("PN");
    expect(getAccountInitials("octocat")).toBe("OC");
    expect(getAccountInitials("   ")).toBe("P");
  });
});

describe("buildAccountProviderViews", () => {
  it("shows only a disconnected GitHub row when providers aren't shown", () => {
    const providers = buildAccountProviderViews({
      githubAccountLabel: null,
      githubConnected: false,
      googleAccounts: [],
      ssoAccounts: [],
      googleAvailable: true,
      showProviders: false,
    });

    expect(providers).toEqual([
      {
        provider: "github",
        label: "GitHub",
        accountLabel: "Not signed in",
        connected: false,
        primary: false,
      },
    ]);
  });

  it("lists SSO accounts first, then GitHub, then Google", () => {
    const providers = buildAccountProviderViews({
      githubAccountLabel: "@octocat",
      githubConnected: true,
      googleAccounts: [{ accountEmail: "person@example.com" }],
      ssoAccounts: [{ accountEmail: "person@work.com", displayName: "Okta" }],
      googleAvailable: true,
      showProviders: true,
    });

    expect(providers.map((provider) => provider.provider)).toEqual([
      "sso",
      "github",
      "google",
    ]);
    expect(providers[1]).toMatchObject({ accountLabel: "@octocat", connected: true });
  });
});
