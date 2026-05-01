import { describe, expect, it } from "vitest";
import { desktopNavigationTarget } from "@/lib/domain/auth/desktop-navigation";

describe("desktopNavigationTarget", () => {
  it("routes plugins deep links and preserves OAuth handoff query params", () => {
    expect(
      desktopNavigationTarget(
        "proliferate://plugins?source=mcp_oauth_callback&status=completed",
      ),
    ).toBe("/plugins?source=mcp_oauth_callback&status=completed");
    expect(
      desktopNavigationTarget(
        "proliferate-local://plugins?source=mcp_oauth_callback&status=failed",
      ),
    ).toBe("/plugins?source=mcp_oauth_callback&status=failed");
  });

  it("accepts a defensive plugins slash form", () => {
    expect(desktopNavigationTarget("proliferate://plugins/")).toBe("/plugins");
  });

  it("keeps legacy powers handoff deep links compatible with the plugins route", () => {
    expect(
      desktopNavigationTarget(
        "proliferate://powers?source=mcp_oauth_callback&status=completed",
      ),
    ).toBe("/plugins?source=mcp_oauth_callback&status=completed");
  });

  it("keeps settings cloud deep links routed to the cloud settings section", () => {
    expect(desktopNavigationTarget("proliferate://settings/cloud?checkout=done")).toBe(
      "/settings?checkout=done&section=cloud",
    );
  });

  it("routes organization invitation handoff links to the flat organization settings section", () => {
    expect(
      desktopNavigationTarget("proliferate://settings/organization?inviteHandoff=abc123"),
    ).toBe("/settings?inviteHandoff=abc123&section=organization");
  });

  it("rejects unsupported desktop navigation links", () => {
    expect(desktopNavigationTarget("https://plugins?source=mcp_oauth_callback")).toBeNull();
    expect(desktopNavigationTarget("proliferate://plugins/extra")).toBeNull();
  });
});
