import { describe, expect, it } from "vitest";
import type { ProductEntry } from "@proliferate/product-client/host/product-host";
import {
  decodeDesktopProductEntry,
  encodeDesktopReturnUrl,
} from "./desktop-navigation";

describe("Desktop ProductEntry codec", () => {
  const roundTrips: Array<{ name: string; url: string; entry: ProductEntry }> = [
    {
      name: "home",
      url: "proliferate://",
      entry: { kind: "home" },
    },
    {
      name: "workspace location state",
      url: "proliferate://workspaces/ws-9?session=sess-1&tab=chat#transcript",
      entry: {
        kind: "workspace",
        workspaceId: "ws-9",
        query: [["session", "sess-1"], ["tab", "chat"]],
        fragment: "transcript",
      },
    },
    {
      name: "organization join",
      url: "proliferate://join/org-123?origin=https%3A%2F%2Fproliferate.corp.example&ref=mail",
      entry: {
        kind: "organization-join",
        organizationId: "org-123",
        serverOrigin: "https://proliferate.corp.example",
        query: [["ref", "mail"]],
      },
    },
    {
      name: "billing success",
      url: "proliferate://billing/success?session=checkout-1",
      entry: {
        kind: "billing-return",
        status: "success",
        query: [["session", "checkout-1"]],
      },
    },
    {
      name: "integration callback",
      url: "proliferate://integrations?source=integration_oauth_callback&status=failed&flowId=flow-2&failureCode=access_denied&extra=keep#result",
      entry: {
        kind: "integration-callback",
        source: "integration_oauth_callback",
        status: "failed",
        flowId: "flow-2",
        failureCode: "access_denied",
        query: [
          ["source", "integration_oauth_callback"],
          ["status", "failed"],
          ["flowId", "flow-2"],
          ["failureCode", "access_denied"],
          ["extra", "keep"],
        ],
        fragment: "result",
      },
    },
    {
      name: "GitHub App settings callback",
      url: "proliferate://settings/account?source=github_app_callback",
      entry: {
        kind: "settings",
        section: "account",
        source: "github_app_callback",
        query: [["source", "github_app_callback"]],
      },
    },
    {
      name: "GitHub App installation callback query",
      url: "proliferate://settings/environments?source=github_app_installation_callback",
      entry: {
        kind: "settings",
        section: "environments",
        query: [["source", "github_app_installation_callback"]],
      },
    },
  ];

  for (const { name, url, entry } of roundTrips) {
    it(`decodes and round-trips ${name}`, () => {
      expect(decodeDesktopProductEntry(url)).toEqual(entry);
      expect(decodeDesktopProductEntry(encodeDesktopReturnUrl(entry))).toEqual(entry);
    });
  }

  it("preserves duplicate pairs, empty values, ordering, Unicode, and fragments", () => {
    const decoded = decodeDesktopProductEntry(
      "proliferate://workspaces/ws-1?x=1&empty=&x=2&unicode=%E2%9C%93#r%C3%A9sum%C3%A9%20notes",
    );

    expect(decoded).toEqual({
      kind: "workspace",
      workspaceId: "ws-1",
      query: [
        ["x", "1"],
        ["empty", ""],
        ["x", "2"],
        ["unicode", "✓"],
      ],
      fragment: "résumé notes",
    });
    expect(encodeDesktopReturnUrl(decoded!)).toBe(
      "proliferate://workspaces/ws-1?x=1&empty=&x=2&unicode=%E2%9C%93#r%C3%A9sum%C3%A9%20notes",
    );
  });

  it("preserves duplicate typed callback pairs through decode and encode", () => {
    const url =
      "proliferate://integrations?source=integration_oauth_callback&status=completed&source=duplicate&status=duplicate&flowId=&extra=keep";
    const decoded = decodeDesktopProductEntry(url);

    expect(decoded).toEqual({
      kind: "integration-callback",
      source: "integration_oauth_callback",
      status: "completed",
      query: [
        ["source", "integration_oauth_callback"],
        ["status", "completed"],
        ["source", "duplicate"],
        ["status", "duplicate"],
        ["flowId", ""],
        ["extra", "keep"],
      ],
    });
    expect(encodeDesktopReturnUrl(decoded!)).toBe(url);
  });

  it("accepts the local scheme and defensive slash forms", () => {
    expect(decodeDesktopProductEntry("proliferate-local://billing/cancel")).toEqual({
      kind: "billing-return",
      status: "cancel",
    });
    expect(decodeDesktopProductEntry("proliferate://integrations/")).toEqual({
      kind: "settings",
      section: "integrations",
    });
    expect(decodeDesktopProductEntry("proliferate://plugins/")).toEqual({
      kind: "settings",
      section: "integrations",
    });
  });

  it("maps legacy settings paths without losing location state", () => {
    expect(
      decodeDesktopProductEntry("proliferate://settings/cloud?checkout=done#credits"),
    ).toEqual({
      kind: "settings",
      section: "billing",
      query: [["checkout", "done"]],
      fragment: "credits",
    });
    expect(decodeDesktopProductEntry("proliferate://settings/slack-bot")).toEqual({
      kind: "settings",
      section: "general",
    });
  });

  it("validates organization issuing origins and drops the transport-only parameter", () => {
    expect(
      decodeDesktopProductEntry(
        "proliferate://join/org-1?origin=http%3A%2F%2F127.0.0.1%3A8000",
      ),
    ).toEqual({
      kind: "organization-join",
      organizationId: "org-1",
      serverOrigin: "http://127.0.0.1:8000",
    });
    expect(
      decodeDesktopProductEntry(
        "proliferate://join/org-1?origin=http%3A%2F%2Fexample.test",
      ),
    ).toEqual({ kind: "organization-join", organizationId: "org-1" });
    expect(
      decodeDesktopProductEntry(
        "proliferate://join/org-1?origin=https%3A%2F%2Fuser%3Apass%40example.test",
      ),
    ).toEqual({ kind: "organization-join", organizationId: "org-1" });
  });

  it("never decodes auth, malformed, unknown, or wrong-scheme URLs", () => {
    expect(
      decodeDesktopProductEntry("proliferate://auth/callback?code=abc&state=xyz"),
    ).toBeNull();
    expect(decodeDesktopProductEntry("proliferate://auth?code=abc")).toBeNull();
    expect(decodeDesktopProductEntry("not a url")).toBeNull();
    expect(decodeDesktopProductEntry("proliferate://plugins/extra")).toBeNull();
    expect(decodeDesktopProductEntry("proliferate://workspaces/cloud-1/extra")).toBeNull();
    expect(decodeDesktopProductEntry("proliferate://settings/unknown")).toBeNull();
    expect(decodeDesktopProductEntry("https://example.test/settings")).toBeNull();
  });

  it("rejects destinations without a current Desktop return transport", () => {
    expect(() => encodeDesktopReturnUrl({ kind: "workflow", workflowId: "wf-1" })).toThrow();
    expect(() => encodeDesktopReturnUrl({ kind: "invitation", token: "tok-1" })).toThrow();
    expect(() => encodeDesktopReturnUrl({ kind: "settings", section: "general" })).toThrow();
    expect(() => encodeDesktopReturnUrl({ kind: "billing-return", status: "done" })).toThrow();
  });
});
