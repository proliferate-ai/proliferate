import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { buildGitHubAppUserAuthorizationServiceView } from "#product/components/settings/panes/account/GitHubAppUserAuthorizationService";

describe("buildGitHubAppUserAuthorizationServiceView", () => {
  it("keeps the provider brand while promoting its action optics", () => {
    const view = buildGitHubAppUserAuthorizationServiceView({
      status: undefined,
      loading: false,
      authorizing: false,
      onAuthorize: vi.fn(),
      onManage: vi.fn(),
    });
    const icon = view.action?.icon;

    expect(isValidElement(icon)).toBe(true);
    expect(isValidElement<{ className?: string }>(icon) ? icon.props.className : null)
      .toContain("icon-control");
  });
});
