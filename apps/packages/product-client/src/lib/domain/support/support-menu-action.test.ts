import { describe, expect, it } from "vitest";
import type { SupportCapability } from "#product/lib/domain/capabilities/server-capability-contract";
import {
  crashRecoverySupportDestination,
  deriveSupportMenuAction,
} from "#product/lib/domain/support/support-menu-action";

describe("deriveSupportMenuAction", () => {
  it("vendor: routes to the existing feedback/prompt report flow", () => {
    const support: SupportCapability = { kind: "vendor", email: "support@proliferate.com", url: null };

    expect(deriveSupportMenuAction(support)).toEqual({ kind: "vendor" });
  });

  it("operator with a url: opens the operator's url directly", () => {
    const support: SupportCapability = {
      kind: "operator",
      email: null,
      url: "https://acme.example.com/support",
    };

    expect(deriveSupportMenuAction(support)).toEqual({
      kind: "operator",
      url: "https://acme.example.com/support",
    });
  });

  it("operator with only an email: mailto:s the configured email", () => {
    const support: SupportCapability = {
      kind: "operator",
      email: "it-help@acme.example.com",
      url: null,
    };

    expect(deriveSupportMenuAction(support)).toEqual({
      kind: "operator",
      url: "mailto:it-help@acme.example.com",
    });
  });

  it("operator prefers url over email when both are configured", () => {
    const support: SupportCapability = {
      kind: "operator",
      email: "it-help@acme.example.com",
      url: "https://acme.example.com/support",
    };

    expect(deriveSupportMenuAction(support)).toEqual({
      kind: "operator",
      url: "https://acme.example.com/support",
    });
  });

  it("operator with neither destination configured degrades to none", () => {
    const support: SupportCapability = { kind: "operator", email: null, url: null };

    expect(deriveSupportMenuAction(support)).toEqual({ kind: "none" });
  });

  it("none: no support action at all", () => {
    const support: SupportCapability = { kind: "none", email: null, url: null };

    expect(deriveSupportMenuAction(support)).toEqual({ kind: "none" });
  });
});

describe("crashRecoverySupportDestination", () => {
  it("uses the vendor emergency email only for hosted vendor support", () => {
    expect(
      crashRecoverySupportDestination(
        { kind: "vendor" },
        "support@proliferate.com",
      ),
    ).toBe(
      "mailto:support@proliferate.com?subject=Proliferate%20crash%20recovery",
    );
  });

  it("preserves operator routing and never substitutes vendor support for none", () => {
    expect(
      crashRecoverySupportDestination(
        { kind: "operator", url: "https://help.acme.example" },
        "support@proliferate.com",
      ),
    ).toBe("https://help.acme.example");
    expect(
      crashRecoverySupportDestination(
        { kind: "none" },
        "support@proliferate.com",
      ),
    ).toBeNull();
  });
});
