import { describe, expect, it } from "vitest";
import type { ProductEntry } from "@proliferate/product-client/host/product-host";
import {
  decodeDesktopProductEntry,
  encodeDesktopReturnUrl,
  productEntryRoute,
} from "@/lib/domain/auth/desktop-navigation";

describe("productEntryRoute", () => {
  // Each entry is the decoded form of the deep link named in the case; the
  // expected string is the in-app route the legacy navigation table produced
  // for that link (order among distinct keys may differ — panes read by key
  // name — but the destination and every value/duplicate/fragment must match).
  const cases: Array<{ name: string; entry: ProductEntry; route: string }> = [
    {
      name: "workspace without query",
      entry: { kind: "workspace", workspaceId: "cloud-workspace-1" },
      route: "/workspaces/cloud-workspace-1",
    },
    {
      name: "workspace with a percent-encoded id",
      entry: { kind: "workspace", workspaceId: "cloud workspace" },
      route: "/workspaces/cloud%20workspace",
    },
    {
      name: "workflow",
      entry: { kind: "workflow", workflowId: "wf-1" },
      route: "/workflows/wf-1",
    },
    {
      name: "organization-join without origin",
      entry: { kind: "organization-join", organizationId: "org-123" },
      route: "/settings?section=account&joinOrganizationId=org-123",
    },
    {
      name: "organization-join with a validated https origin",
      entry: {
        kind: "organization-join",
        organizationId: "org-123",
        serverOrigin: "https://proliferate.corp.example",
      },
      route:
        "/settings?section=account&joinOrganizationId=org-123&joinServerOrigin=https%3A%2F%2Fproliferate.corp.example",
    },
    {
      name: "invitation lands on account settings",
      entry: { kind: "invitation", token: "tok-1" },
      route: "/settings?section=account",
    },
    {
      name: "billing-return success",
      entry: { kind: "billing-return", status: "success" },
      route: "/settings?checkout=success&section=billing",
    },
    {
      name: "billing-return cancel",
      entry: { kind: "billing-return", status: "cancel" },
      route: "/settings?checkout=cancel&section=billing",
    },
    {
      name: "integration-callback full outcome",
      entry: {
        kind: "integration-callback",
        source: "integration_oauth_callback",
        status: "completed",
        flowId: "flow-1",
      },
      route: "/settings?section=integrations&status=completed&flowId=flow-1",
    },
    {
      name: "integration-callback failure outcome",
      entry: {
        kind: "integration-callback",
        source: "mcp_oauth_callback",
        status: "failed",
        flowId: "flow-2",
        failureCode: "access_denied",
      },
      route:
        "/settings?section=integrations&status=failed&flowId=flow-2&failureCode=access_denied",
    },
    {
      name: "integration-callback with an unrecognized status kept in query",
      entry: {
        kind: "integration-callback",
        source: "integration_oauth_callback",
        flowId: "f1",
        query: [
          ["status", "weird"],
          ["extra", "keep"],
          ["extra2", "v2"],
        ],
      },
      route: "/settings?section=integrations&flowId=f1&status=weird&extra=keep&extra2=v2",
    },
    {
      name: "settings integrations pane (bare integrations link)",
      entry: { kind: "settings", section: "integrations" },
      route: "/settings?section=integrations",
    },
    {
      name: "settings billing from a legacy cloud link (checkout kept)",
      entry: { kind: "settings", section: "billing", query: [["checkout", "done"]] },
      route: "/settings?section=billing&checkout=done",
    },
    {
      name: "settings account (github-app source dropped as inert)",
      entry: { kind: "settings", section: "account", source: "github_app_callback" },
      route: "/settings?section=account",
    },
    {
      name: "settings general (parked slack-bot landing)",
      entry: { kind: "settings", section: "general" },
      route: "/settings?section=general",
    },
  ];

  for (const { name, entry, route } of cases) {
    it(`routes ${name}`, () => {
      expect(productEntryRoute(entry)).toBe(route);
    });
  }

  it("serializes query spaces via URLSearchParams (space becomes +)", () => {
    expect(
      productEntryRoute({ kind: "workspace", workspaceId: "ws-1", query: [["note", "a b"]] }),
    ).toBe("/workspaces/ws-1?note=a+b");
    expect(
      productEntryRoute({ kind: "settings", section: "account", query: [["note", "a b"]] }),
    ).toBe("/settings?section=account&note=a+b");
  });

  it("preserves ordered duplicate query keys without collapsing them", () => {
    expect(
      productEntryRoute({
        kind: "workspace",
        workspaceId: "ws-1",
        query: [
          ["x", "1"],
          ["x", "2"],
        ],
      }),
    ).toBe("/workspaces/ws-1?x=1&x=2");
    expect(
      productEntryRoute({
        kind: "settings",
        section: "account",
        query: [
          ["x", "1"],
          ["x", "2"],
        ],
      }),
    ).toBe("/settings?section=account&x=1&x=2");
  });

  it("appends a fragment with exactly one leading hash", () => {
    expect(
      productEntryRoute({
        kind: "workspace",
        workspaceId: "ws-1",
        query: [["tab", "chat"]],
        fragment: "thread-42",
      }),
    ).toBe("/workspaces/ws-1?tab=chat#thread-42");
  });

  it("drops a leftover query pair that would shadow a canonical destination key", () => {
    // A canonical key (section) supplied both by the destination and a leftover
    // query pair resolves to the destination's value, not two `section` pairs.
    expect(
      productEntryRoute({
        kind: "settings",
        section: "account",
        query: [["section", "billing"]],
      }),
    ).toBe("/settings?section=account");
  });

  it("maps a decoded deep link end to end (decode -> route)", () => {
    const entry = decodeDesktopProductEntry(
      "proliferate-local://workspaces/cloud%20workspace?x=1&x=2#frag",
    );
    expect(entry).not.toBeNull();
    expect(productEntryRoute(entry!)).toBe("/workspaces/cloud%20workspace?x=1&x=2#frag");
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
