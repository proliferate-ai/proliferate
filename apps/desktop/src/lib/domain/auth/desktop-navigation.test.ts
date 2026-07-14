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

  it("preserves raw percent-encoded query bytes (workspaces keep %20, settings match legacy serialization)", () => {
    // Workspace routes append the raw URL.search verbatim, so %20 survives.
    expect(desktopNavigationTarget("proliferate://workspaces/ws-1?note=a%20b")).toBe(
      "/workspaces/ws-1?note=a%20b",
    );
    // Settings routes rebuild via URLSearchParams (byte-identical to the legacy
    // table), which serializes the space as "+".
    expect(desktopNavigationTarget("proliferate://settings/account?note=a%20b")).toBe(
      "/settings?note=a+b&section=account",
    );
  });

  it("preserves duplicate query keys instead of collapsing them", () => {
    expect(desktopNavigationTarget("proliferate://settings/account?x=1&x=2")).toBe(
      "/settings?x=1&x=2&section=account",
    );
    expect(desktopNavigationTarget("proliferate://workspaces/ws-1?x=1&x=2")).toBe(
      "/workspaces/ws-1?x=1&x=2",
    );
  });

  it("passes an integration callback's unrecognized status and extra params straight through", () => {
    expect(
      desktopNavigationTarget(
        "proliferate://integrations?source=integration_oauth_callback&status=weird&flowId=f1&extra=keep&extra2=v2",
      ),
    ).toBe(
      "/settings?source=integration_oauth_callback&status=weird&flowId=f1&extra=keep&extra2=v2&section=integrations",
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
  // Desktop URL, re-encoded; the entry must survive both directions. Location
  // state (query/fragment) is omitted when empty, so entries without query
  // carry no `query` field.
  const roundTrips: Array<{ name: string; url: string; entry: ProductEntry }> = [
    {
      name: "workspace without query",
      url: "proliferate://workspaces/cloud-workspace-1",
      entry: { kind: "workspace", workspaceId: "cloud-workspace-1" },
    },
    {
      name: "workspace with query",
      url: "proliferate://workspaces/ws-9?session=sess-1&tab=chat",
      entry: {
        kind: "workspace",
        workspaceId: "ws-9",
        query: [
          ["session", "sess-1"],
          ["tab", "chat"],
        ],
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
      entry: { kind: "billing-return", status: "success" },
    },
    {
      name: "billing-return cancel",
      url: "proliferate://billing/cancel",
      entry: { kind: "billing-return", status: "cancel" },
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
      },
    },
    {
      name: "settings organization return URL",
      url: "proliferate://settings/organization?source=github_app_callback",
      entry: {
        kind: "settings",
        section: "organization",
        source: "github_app_callback",
      },
    },
    {
      name: "settings environments github-app-callback return URL",
      url: "proliferate://settings/environments?source=github_app_callback",
      entry: {
        kind: "settings",
        section: "environments",
        source: "github_app_callback",
      },
    },
    {
      name: "settings environments github-app-installation-callback (source kept in query)",
      url: "proliferate://settings/environments?source=github_app_installation_callback",
      entry: {
        kind: "settings",
        section: "environments",
        query: [["source", "github_app_installation_callback"]],
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
      }),
    ).toBe("proliferate://settings/account?source=github_app_callback");
    expect(
      encodeDesktopReturnUrl({
        kind: "settings",
        section: "environments",
        source: "github_app_callback",
      }),
    ).toBe("proliferate://settings/environments?source=github_app_callback");
  });

  it("preserves ordered duplicate query keys and empty values (no collapse)", () => {
    const entry = decodeDesktopProductEntry(
      "proliferate://workspaces/ws-1?x=1&x=2&empty=&y=3",
    );
    expect(entry).toEqual({
      kind: "workspace",
      workspaceId: "ws-1",
      query: [
        ["x", "1"],
        ["x", "2"],
        ["empty", ""],
        ["y", "3"],
      ],
    });
    // Duplicates and empties survive decode → encode → decode intact.
    expect(decodeDesktopProductEntry(encodeDesktopReturnUrl(entry!))).toEqual(entry);
  });

  it("preserves query ordering exactly as received", () => {
    const entry = decodeDesktopProductEntry(
      "proliferate://workspaces/ws-1?b=2&a=1&c=3",
    );
    expect(entry).toEqual({
      kind: "workspace",
      workspaceId: "ws-1",
      query: [
        ["b", "2"],
        ["a", "1"],
        ["c", "3"],
      ],
    });
  });

  it("preserves Unicode query values through decode and round-trip", () => {
    const entry = decodeDesktopProductEntry(
      "proliferate://workspaces/ws-1?note=caf%C3%A9&emoji=%F0%9F%9A%80",
    );
    expect(entry).toEqual({
      kind: "workspace",
      workspaceId: "ws-1",
      query: [
        ["note", "café"],
        ["emoji", "🚀"],
      ],
    });
    expect(decodeDesktopProductEntry(encodeDesktopReturnUrl(entry!))).toEqual(entry);
  });

  it("preserves a fragment through decode, encode, and re-decode", () => {
    const entry = decodeDesktopProductEntry(
      "proliferate://workspaces/ws-1?tab=chat#thread-42",
    );
    expect(entry).toEqual({
      kind: "workspace",
      workspaceId: "ws-1",
      query: [["tab", "chat"]],
      fragment: "thread-42",
    });
    expect(decodeDesktopProductEntry(encodeDesktopReturnUrl(entry!))).toEqual(entry);
  });

  it("preserves a Unicode fragment with no query", () => {
    const entry = decodeDesktopProductEntry("proliferate://settings/account#caf%C3%A9");
    expect(entry).toEqual({
      kind: "settings",
      section: "account",
      fragment: "café",
    });
    expect(decodeDesktopProductEntry(encodeDesktopReturnUrl(entry!))).toEqual(entry);
  });

  it("keeps an unrecognized integration status and extra params in query", () => {
    expect(
      decodeDesktopProductEntry(
        "proliferate://integrations?source=integration_oauth_callback&status=weird&flowId=f1&extra=keep&extra2=v2",
      ),
    ).toEqual({
      kind: "integration-callback",
      source: "integration_oauth_callback",
      flowId: "f1",
      query: [
        ["status", "weird"],
        ["extra", "keep"],
        ["extra2", "v2"],
      ],
    });
  });

  it("decodes local-scheme URLs the same as the default scheme", () => {
    expect(
      decodeDesktopProductEntry("proliferate-local://billing/cancel"),
    ).toEqual({ kind: "billing-return", status: "cancel" });
  });

  it("decodes settings/cloud legacy links to the billing section", () => {
    expect(
      decodeDesktopProductEntry("proliferate://settings/cloud?checkout=done"),
    ).toEqual({ kind: "settings", section: "billing", query: [["checkout", "done"]] });
  });

  it("decodes bare integrations links to the integrations settings pane", () => {
    expect(decodeDesktopProductEntry("proliferate://integrations/")).toEqual({
      kind: "settings",
      section: "integrations",
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
      encodeDesktopReturnUrl({ kind: "settings", section: "general" }),
    ).toThrow();
    expect(() =>
      encodeDesktopReturnUrl({ kind: "billing-return", status: "done" }),
    ).toThrow();
  });
});
