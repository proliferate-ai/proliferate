import { describe, expect, it } from "vitest";
import type { ProductEntry } from "@proliferate/product-client/host/product-host";
import {
  decodeDesktopProductEntry,
  desktopNavigationTarget,
  encodeDesktopReturnUrl,
} from "@/lib/domain/auth/desktop-navigation";

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

describe("decodeDesktopProductEntry / encodeDesktopReturnUrl", () => {
  // Each case is normalized by decode and, where the entry kind has a current
  // Desktop URL, re-encoded; the entry must survive both directions.
  const roundTrips: Array<{ name: string; url: string; entry: ProductEntry }> = [
    {
      name: "workspace without query",
      url: "proliferate://workspaces/cloud-workspace-1",
      entry: { kind: "workspace", workspaceId: "cloud-workspace-1", query: {} },
    },
    {
      name: "workspace with query",
      url: "proliferate://workspaces/ws-9?session=sess-1&tab=chat",
      entry: {
        kind: "workspace",
        workspaceId: "ws-9",
        query: { session: "sess-1", tab: "chat" },
      },
    },
    {
      name: "organization-join without origin",
      url: "proliferate://join/org-123",
      entry: { kind: "organization-join", organizationId: "org-123" },
    },
    {
      name: "organization-join with validated https origin",
      url: "proliferate://join/org-123?origin=https%3A%2F%2Fproliferate.corp.example",
      entry: {
        kind: "organization-join",
        organizationId: "org-123",
        serverOrigin: "https://proliferate.corp.example",
      },
    },
    {
      name: "billing-return success",
      url: "proliferate://billing/success",
      entry: { kind: "billing-return", status: "success", query: {} },
    },
    {
      name: "billing-return cancel",
      url: "proliferate://billing/cancel",
      entry: { kind: "billing-return", status: "cancel", query: {} },
    },
    {
      name: "integration-callback (integration_oauth_callback, full)",
      url: "proliferate://integrations?source=integration_oauth_callback&status=failed&flowId=flow-2&failureCode=access_denied",
      entry: {
        kind: "integration-callback",
        source: "integration_oauth_callback",
        status: "failed",
        flowId: "flow-2",
        failureCode: "access_denied",
      },
    },
    {
      name: "integration-callback (mcp_oauth_callback, minimal)",
      url: "proliferate://integrations?source=mcp_oauth_callback&status=completed",
      entry: {
        kind: "integration-callback",
        source: "mcp_oauth_callback",
        status: "completed",
      },
    },
    {
      name: "settings account github-app return URL",
      url: "proliferate://settings/account?source=github_app_callback",
      entry: {
        kind: "settings",
        section: "account",
        source: "github_app_callback",
        query: {},
      },
    },
    {
      name: "settings organization return URL",
      url: "proliferate://settings/organization?source=github_app_callback",
      entry: {
        kind: "settings",
        section: "organization",
        source: "github_app_callback",
        query: {},
      },
    },
    {
      name: "settings environments github-app-callback return URL",
      url: "proliferate://settings/environments?source=github_app_callback",
      entry: {
        kind: "settings",
        section: "environments",
        source: "github_app_callback",
        query: {},
      },
    },
    {
      name: "settings environments github-app-installation-callback (source kept in query)",
      url: "proliferate://settings/environments?source=github_app_installation_callback",
      entry: {
        kind: "settings",
        section: "environments",
        query: { source: "github_app_installation_callback" },
      },
    },
  ];

  for (const { name, url, entry } of roundTrips) {
    it(`decodes ${name}`, () => {
      expect(decodeDesktopProductEntry(url)).toEqual(entry);
    });

    it(`round-trips ${name} through the encoder`, () => {
      const encoded = encodeDesktopReturnUrl(entry);
      expect(decodeDesktopProductEntry(encoded)).toEqual(entry);
    });
  }

  it("preserves the literal github-app return URLs verbatim on re-encode", () => {
    expect(
      encodeDesktopReturnUrl({
        kind: "settings",
        section: "account",
        source: "github_app_callback",
        query: {},
      }),
    ).toBe("proliferate://settings/account?source=github_app_callback");
    expect(
      encodeDesktopReturnUrl({
        kind: "settings",
        section: "environments",
        source: "github_app_callback",
        query: {},
      }),
    ).toBe("proliferate://settings/environments?source=github_app_callback");
  });

  it("decodes local-scheme URLs the same as the default scheme", () => {
    expect(
      decodeDesktopProductEntry("proliferate-local://billing/cancel"),
    ).toEqual({ kind: "billing-return", status: "cancel", query: {} });
  });

  it("decodes settings/cloud legacy links to the billing section", () => {
    expect(
      decodeDesktopProductEntry("proliferate://settings/cloud?checkout=done"),
    ).toEqual({ kind: "settings", section: "billing", query: { checkout: "done" } });
  });

  it("decodes bare integrations links to the integrations settings pane", () => {
    expect(decodeDesktopProductEntry("proliferate://integrations/")).toEqual({
      kind: "settings",
      section: "integrations",
      query: {},
    });
  });

  it("returns null for auth-callback, malformed, unknown, and wrong-scheme URLs", () => {
    // Auth callbacks (host "auth") are handled by the callback workflow, not
    // navigation; they must not decode to a ProductEntry.
    expect(
      decodeDesktopProductEntry("proliferate://auth/callback?code=abc&state=xyz"),
    ).toBeNull();
    expect(decodeDesktopProductEntry("proliferate://auth?code=abc")).toBeNull();
    expect(decodeDesktopProductEntry("not a url")).toBeNull();
    expect(decodeDesktopProductEntry("proliferate://plugins/extra")).toBeNull();
    expect(decodeDesktopProductEntry("proliferate://workspaces/cloud-1/extra")).toBeNull();
    expect(decodeDesktopProductEntry("proliferate://settings/unknown")).toBeNull();
    expect(
      decodeDesktopProductEntry("https://plugins?source=mcp_oauth_callback"),
    ).toBeNull();
  });

  it("throws from the encoder for entry kinds/sections with no current Desktop URL", () => {
    expect(() =>
      encodeDesktopReturnUrl({ kind: "workflow", workflowId: "wf-1" }),
    ).toThrow();
    expect(() =>
      encodeDesktopReturnUrl({ kind: "invitation", token: "tok-1" }),
    ).toThrow();
    expect(() =>
      encodeDesktopReturnUrl({ kind: "settings", section: "general", query: {} }),
    ).toThrow();
    expect(() =>
      encodeDesktopReturnUrl({ kind: "billing-return", status: "done", query: {} }),
    ).toThrow();
  });
});
