import { describe, expect, it } from "vitest";
import { desktopNavigationTarget } from "@/lib/domain/auth/desktop-navigation";

describe("desktopNavigationTarget", () => {
  it("routes integration deep links and preserves OAuth handoff query params", () => {
    expect(
      desktopNavigationTarget(
        "proliferate://integrations?source=mcp_oauth_callback&status=completed",
      ),
    ).toBe("/integrations?source=mcp_oauth_callback&status=completed");
    expect(
      desktopNavigationTarget(
        "proliferate://plugins?source=mcp_oauth_callback&status=completed",
      ),
    ).toBe("/integrations?source=mcp_oauth_callback&status=completed");
    expect(
      desktopNavigationTarget(
        "proliferate-local://plugins?source=mcp_oauth_callback&status=failed",
      ),
    ).toBe("/integrations?source=mcp_oauth_callback&status=failed");
  });

  it("accepts defensive integration and plugin slash forms", () => {
    expect(desktopNavigationTarget("proliferate://integrations/")).toBe("/integrations");
    expect(desktopNavigationTarget("proliferate://plugins/")).toBe("/integrations");
  });

  it("keeps legacy powers handoff deep links compatible with integrations", () => {
    expect(
      desktopNavigationTarget(
        "proliferate://powers?source=mcp_oauth_callback&status=completed",
      ),
    ).toBe("/integrations?source=mcp_oauth_callback&status=completed");
  });

  it("routes workspace deep links to the desktop workspace opener", () => {
    expect(desktopNavigationTarget("proliferate://workspaces/cloud-workspace-1")).toBe(
      "/workspaces/cloud-workspace-1",
    );
    expect(desktopNavigationTarget("proliferate-local://workspaces/cloud%20workspace")).toBe(
      "/workspaces/cloud%20workspace",
    );
  });

  it("routes legacy settings cloud deep links to billing", () => {
    expect(desktopNavigationTarget("proliferate://settings/cloud?checkout=done")).toBe(
      "/settings?checkout=done&section=billing",
    );
  });

  it("routes billing deep links to billing settings", () => {
    expect(desktopNavigationTarget("proliferate://billing/success")).toBe(
      "/settings?checkout=success&section=billing",
    );
    expect(desktopNavigationTarget("proliferate-local://billing/cancel")).toBe(
      "/settings?checkout=cancel&section=billing",
    );
    expect(desktopNavigationTarget("proliferate://settings/billing?checkout=success")).toBe(
      "/settings?checkout=success&section=billing",
    );
  });

  it("routes organization invitation handoff links to the flat organization settings section", () => {
    expect(
      desktopNavigationTarget("proliferate://settings/organization?inviteHandoff=abc123"),
    ).toBe("/settings?inviteHandoff=abc123&section=organization");
  });

  it("routes parked Slack bot settings links to general settings", () => {
    expect(desktopNavigationTarget("proliferate://settings/slack-bot")).toBe(
      "/settings?section=general",
    );
  });

  it("rejects unsupported desktop navigation links", () => {
    expect(desktopNavigationTarget("https://plugins?source=mcp_oauth_callback")).toBeNull();
    expect(desktopNavigationTarget("proliferate://plugins/extra")).toBeNull();
    expect(desktopNavigationTarget("proliferate://workspaces/cloud-1/extra")).toBeNull();
  });
});
