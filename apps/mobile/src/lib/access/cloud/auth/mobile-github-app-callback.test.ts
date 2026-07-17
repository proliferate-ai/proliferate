import { describe, expect, it } from "vitest";

import { isMobileGitHubAppCallbackUrl } from "./mobile-github-app-callback";

describe("isMobileGitHubAppCallbackUrl", () => {
  it("matches the custom-scheme App callback", () => {
    expect(
      isMobileGitHubAppCallbackUrl(
        "proliferate://settings/environments?source=github_app_callback",
      ),
    ).toBe(true);
  });

  it("matches the staging-scheme App callback", () => {
    expect(
      isMobileGitHubAppCallbackUrl(
        "proliferate-staging://settings/environments?source=github_app_callback",
      ),
    ).toBe(true);
  });

  it("matches an https callback with the source param", () => {
    expect(
      isMobileGitHubAppCallbackUrl(
        "https://app.proliferate.ai/settings/environments?source=github_app_callback",
      ),
    ).toBe(true);
  });

  it("does not match the OAuth sign-in callback", () => {
    expect(isMobileGitHubAppCallbackUrl("proliferate://auth/callback?code=abc&state=xyz")).toBe(false);
  });

  it("does not match a workspace deep link", () => {
    expect(
      isMobileGitHubAppCallbackUrl("https://app.proliferate.ai/workspaces/ws_123"),
    ).toBe(false);
  });

  it("does not match null", () => {
    expect(isMobileGitHubAppCallbackUrl(null)).toBe(false);
  });
});
