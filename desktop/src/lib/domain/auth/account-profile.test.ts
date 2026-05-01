import { describe, expect, it } from "vitest";
import {
  getAccountActionDescription,
  getAccountDisplayName,
  getAccountInitials,
  getGitHubStatusLabel,
} from "./account-profile";

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
        isAuthenticated: true,
        localMode: false,
        signInUnavailable: false,
      }),
    ).toBe("Username unavailable");

    expect(
      getGitHubStatusLabel({
        cloudSignInChecking: false,
        devAuthBypassed: false,
        isAuthenticated: false,
        localMode: true,
        signInUnavailable: false,
      }),
    ).toBe("Unavailable");
  });
});

describe("getAccountActionDescription", () => {
  it("uses reconnect copy based on whether a GitHub login is available", () => {
    expect(
      getAccountActionDescription({
        devAuthBypassed: false,
        isAuthenticated: true,
        localMode: false,
        signInUnavailable: false,
        signedInWhileCloudUnavailable: false,
        githubLogin: "octocat",
      }),
    ).toContain("manage repository access");

    expect(
      getAccountActionDescription({
        devAuthBypassed: false,
        isAuthenticated: true,
        localMode: false,
        signInUnavailable: false,
        signedInWhileCloudUnavailable: false,
        githubLogin: null,
      }),
    ).toContain("refresh account details");
  });
});

describe("getAccountInitials", () => {
  it("builds stable initials for avatars", () => {
    expect(getAccountInitials("Person Name")).toBe("PN");
    expect(getAccountInitials("octocat")).toBe("OC");
    expect(getAccountInitials("   ")).toBe("P");
  });
});
