import { describe, expect, it } from "vitest";
import { parseServerCapabilities } from "./server-capability-contract";

function validRaw(): Record<string, unknown> {
  return {
    contractVersion: 1,
    deployment: {
      mode: "self_managed",
      displayName: "Acme Internal",
      logoUrl: "https://acme.example.com/logo.svg",
    },
    billing: false,
    usageMetering: false,
    cloudWorkspaces: true,
    agentGateway: true,
    webApp: { available: false, baseUrl: null },
    support: { kind: "operator", email: "it@acme.example.com", url: null },
    pricing: { available: false, url: null },
  };
}

describe("parseServerCapabilities", () => {
  it("parses a well-formed contract", () => {
    const parsed = parseServerCapabilities(validRaw());

    expect(parsed).not.toBeNull();
    expect(parsed?.contractVersion).toBe(1);
    expect(parsed?.deployment.mode).toBe("self_managed");
    expect(parsed?.deployment.displayName).toBe("Acme Internal");
    expect(parsed?.cloudWorkspaces).toBe(true);
    expect(parsed?.agentGateway).toBe(true);
    expect(parsed?.support.kind).toBe("operator");
    expect(parsed?.support.email).toBe("it@acme.example.com");
  });

  it("returns null when the block is absent or not an object", () => {
    expect(parseServerCapabilities(undefined)).toBeNull();
    expect(parseServerCapabilities(null)).toBeNull();
    expect(parseServerCapabilities("nope")).toBeNull();
    expect(parseServerCapabilities(42)).toBeNull();
  });

  it("returns null when deployment.mode is missing or invalid", () => {
    const noMode = validRaw();
    delete (noMode.deployment as Record<string, unknown>).mode;
    expect(parseServerCapabilities(noMode)).toBeNull();

    const badMode = validRaw();
    (badMode.deployment as Record<string, unknown>).mode = "franchise";
    expect(parseServerCapabilities(badMode)).toBeNull();
  });

  it("defaults unknown/missing capability booleans to false", () => {
    const sparse: Record<string, unknown> = {
      deployment: { mode: "self_managed" },
    };
    const parsed = parseServerCapabilities(sparse);

    expect(parsed).not.toBeNull();
    expect(parsed?.contractVersion).toBe(0);
    expect(parsed?.billing).toBe(false);
    expect(parsed?.usageMetering).toBe(false);
    expect(parsed?.cloudWorkspaces).toBe(false);
    expect(parsed?.agentGateway).toBe(false);
    expect(parsed?.deployment.displayName).toBe("");
    expect(parsed?.webApp.available).toBe(false);
    expect(parsed?.support.kind).toBe("none");
    expect(parsed?.pricing.available).toBe(false);
  });

  it("rejects unsafe URLs but keeps safe ones", () => {
    const raw = validRaw();
    (raw.deployment as Record<string, unknown>).logoUrl = "javascript:alert(1)";
    (raw.webApp as Record<string, unknown>) = {
      available: true,
      baseUrl: "https://web.example.com",
    };
    (raw.support as Record<string, unknown>) = {
      kind: "operator",
      email: "not-an-email",
      url: "ftp://sketchy",
    };
    const parsed = parseServerCapabilities(raw);

    expect(parsed?.deployment.logoUrl).toBeNull();
    expect(parsed?.webApp.baseUrl).toBe("https://web.example.com");
    expect(parsed?.support.email).toBeNull();
    expect(parsed?.support.url).toBeNull();
  });

  it("accepts a mailto support url", () => {
    const raw = validRaw();
    (raw.support as Record<string, unknown>) = {
      kind: "operator",
      email: null,
      url: "mailto:help@acme.example.com",
    };
    const parsed = parseServerCapabilities(raw);
    expect(parsed?.support.url).toBe("mailto:help@acme.example.com");
  });
});
