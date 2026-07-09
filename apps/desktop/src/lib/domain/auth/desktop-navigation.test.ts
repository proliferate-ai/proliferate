import { describe, expect, it } from "vitest";
import { desktopNavigationTarget } from "@/lib/domain/auth/desktop-navigation";

describe("desktopNavigationTarget", () => {
  it("routes integration OAuth returns to the integrations pane with the flow outcome", () => {
    expect(
      desktopNavigationTarget(
        "proliferate://plugins?source=integration_oauth_callback&status=completed&flowId=flow-1",
      ),
    ).toBe(
      "/settings?source=integration_oauth_callback&status=completed&flowId=flow-1&section=integrations",
    );
    expect(
      desktopNavigationTarget(
        "proliferate://integrations?source=integration_oauth_callback&status=completed",
      ),
    ).toBe("/settings?source=integration_oauth_callback&status=completed&section=integrations");
    expect(
      desktopNavigationTarget(
        "proliferate-local://plugins?source=integration_oauth_callback&status=failed&flowId=flow-2&failureCode=access_denied",
      ),
    ).toBe(
      "/settings?source=integration_oauth_callback&status=failed&flowId=flow-2&failureCode=access_denied&section=integrations",
    );
  });

  it("accepts defensive integration and plugin slash forms", () => {
    expect(desktopNavigationTarget("proliferate://integrations/")).toBe("/settings?section=integrations");
    expect(desktopNavigationTarget("proliferate://plugins/")).toBe("/settings?section=integrations");
  });

  it("keeps legacy powers handoff deep links routed with integrations", () => {
    expect(
      desktopNavigationTarget(
        "proliferate://powers?source=mcp_oauth_callback&status=completed",
      ),
    ).toBe("/settings?source=mcp_oauth_callback&status=completed&section=integrations");
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

  it("routes account settings deep links to account settings", () => {
    expect(desktopNavigationTarget("proliferate://settings/account?source=github_app_callback")).toBe(
      "/settings?source=github_app_callback&section=account",
    );
  });

  it("routes organization join links to the account settings section (reachable by non-admins)", () => {
    expect(
      desktopNavigationTarget("proliferate://join/org-123"),
    ).toBe("/settings?section=account&joinOrganizationId=org-123");
  });

  it("forwards a valid https issuing-server origin as joinServerOrigin", () => {
    expect(
      desktopNavigationTarget(
        "proliferate://join/org-123?origin=https%3A%2F%2Fproliferate.corp.example",
      ),
    ).toBe(
      "/settings?section=account&joinOrganizationId=org-123&joinServerOrigin=https%3A%2F%2Fproliferate.corp.example",
    );
  });

  it("allows an http origin only for loopback dev servers", () => {
    expect(
      desktopNavigationTarget("proliferate://join/org-123?origin=http%3A%2F%2F127.0.0.1%3A8000"),
    ).toBe(
      "/settings?section=account&joinOrganizationId=org-123&joinServerOrigin=http%3A%2F%2F127.0.0.1%3A8000",
    );
  });

  it("drops a non-loopback http origin (downgrade-attack guard)", () => {
    expect(
      desktopNavigationTarget("proliferate://join/org-123?origin=http%3A%2F%2Fproliferate.corp.example"),
    ).toBe("/settings?section=account&joinOrganizationId=org-123");
  });

  it("drops a malformed origin", () => {
    expect(
      desktopNavigationTarget("proliferate://join/org-123?origin=not-a-url"),
    ).toBe("/settings?section=account&joinOrganizationId=org-123");
  });

  it("drops an origin carrying embedded credentials (userinfo phishing guard)", () => {
    expect(
      desktopNavigationTarget(
        "proliferate://join/org-123?origin=https%3A%2F%2Fuser%3Apass%40proliferate.corp.example",
      ),
    ).toBe("/settings?section=account&joinOrganizationId=org-123");
  });

  it("leaves the join route unchanged when no origin is supplied", () => {
    expect(
      desktopNavigationTarget("proliferate://join/org-123"),
    ).toBe("/settings?section=account&joinOrganizationId=org-123");
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
