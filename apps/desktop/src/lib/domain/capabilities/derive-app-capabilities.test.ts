import { describe, expect, it } from "vitest";
import {
  deriveAppCapabilities,
  resolveEffectiveContract,
} from "./app-capabilities";
import type { ServerCapabilityContract } from "./server-capability-contract";

const FALLBACK = {
  supportEmail: "support@proliferate.com",
  pricingUrl: "https://proliferate.com/pricing",
};

function contract(
  overrides: Partial<ServerCapabilityContract> = {},
): ServerCapabilityContract {
  return {
    contractVersion: 1,
    deployment: { mode: "self_managed", displayName: "", logoUrl: null },
    billing: false,
    usageMetering: false,
    cloudWorkspaces: false,
    agentGateway: false,
    webApp: { available: false, baseUrl: null },
    support: { kind: "none", email: null, url: null },
    pricing: { available: false, url: null },
    ...overrides,
  };
}

describe("deriveAppCapabilities", () => {
  it("maps a hosted contract to full capabilities and no self-managed identity", () => {
    const caps = deriveAppCapabilities({
      reachable: true,
      connectedServerHost: "app.proliferate.com",
      contract: contract({
        deployment: { mode: "hosted_product", displayName: "Proliferate", logoUrl: null },
        billing: true,
        usageMetering: true,
        cloudWorkspaces: true,
        agentGateway: true,
        webApp: { available: true, baseUrl: "https://web.proliferate.com" },
        support: { kind: "vendor", email: "support@proliferate.com", url: null },
        pricing: { available: true, url: "https://proliferate.com/pricing" },
      }),
    });

    expect(caps.cloudEnabled).toBe(true);
    expect(caps.billingEnabled).toBe(true);
    expect(caps.usageMeteringEnabled).toBe(true);
    expect(caps.cloudComputeEnabled).toBe(true);
    expect(caps.agentGatewayEnabled).toBe(true);
    expect(caps.isSelfManaged).toBe(false);
    expect(caps.serverDisplayName).toBeNull();
    expect(caps.serverLogoUrl).toBeNull();
    expect(caps.webApp.baseUrl).toBe("https://web.proliferate.com");
    expect(caps.support.kind).toBe("vendor");
    expect(caps.pricing.available).toBe(true);
  });

  it("keeps every vendor/cloud surface off for a base self-managed contract", () => {
    const caps = deriveAppCapabilities({
      reachable: true,
      connectedServerHost: "acme.example.com",
      contract: contract({ deployment: { mode: "self_managed", displayName: "", logoUrl: null } }),
    });

    // Sign-in still works against a self-managed control plane.
    expect(caps.cloudEnabled).toBe(true);
    expect(caps.billingEnabled).toBe(false);
    expect(caps.usageMeteringEnabled).toBe(false);
    expect(caps.cloudComputeEnabled).toBe(false);
    expect(caps.agentGatewayEnabled).toBe(false);
    expect(caps.isSelfManaged).toBe(true);
    // No operator name -> fall back to the connected origin host.
    expect(caps.serverDisplayName).toBe("acme.example.com");
    expect(caps.webApp.available).toBe(false);
    expect(caps.support.kind).toBe("none");
    expect(caps.pricing.available).toBe(false);
  });

  it("shows only the configured add-ons on a self-managed contract", () => {
    const caps = deriveAppCapabilities({
      reachable: true,
      connectedServerHost: "acme.example.com",
      contract: contract({
        deployment: { mode: "self_managed", displayName: "Acme Internal", logoUrl: "https://acme.example.com/logo.svg" },
        cloudWorkspaces: true,
        agentGateway: true,
      }),
    });

    expect(caps.isSelfManaged).toBe(true);
    expect(caps.serverDisplayName).toBe("Acme Internal");
    expect(caps.serverLogoUrl).toBe("https://acme.example.com/logo.svg");
    expect(caps.cloudComputeEnabled).toBe(true);
    expect(caps.agentGatewayEnabled).toBe(true);
    // Billing/web/pricing stay off unless declared.
    expect(caps.billingEnabled).toBe(false);
    expect(caps.webApp.available).toBe(false);
  });

  it("treats a missing contract as a conservative self-managed server", () => {
    const caps = deriveAppCapabilities({
      reachable: true,
      connectedServerHost: "unknown.example.com",
      contract: null,
    });

    expect(caps.cloudEnabled).toBe(true);
    expect(caps.billingEnabled).toBe(false);
    expect(caps.cloudComputeEnabled).toBe(false);
    expect(caps.agentGatewayEnabled).toBe(false);
    expect(caps.isSelfManaged).toBe(true);
    expect(caps.deploymentMode).toBe("self_managed");
    expect(caps.serverDisplayName).toBe("unknown.example.com");
    expect(caps.webApp.available).toBe(false);
    expect(caps.support.kind).toBe("none");
    expect(caps.pricing.available).toBe(false);
  });

  it("gates capabilities on reachability", () => {
    const caps = deriveAppCapabilities({
      reachable: false,
      connectedServerHost: "app.proliferate.com",
      contract: contract({
        deployment: { mode: "hosted_product", displayName: "Proliferate", logoUrl: null },
        billing: true,
        cloudWorkspaces: true,
        agentGateway: true,
      }),
    });

    expect(caps.cloudEnabled).toBe(false);
    expect(caps.billingEnabled).toBe(false);
    expect(caps.cloudComputeEnabled).toBe(false);
    expect(caps.agentGatewayEnabled).toBe(false);
  });
});

describe("resolveEffectiveContract", () => {
  it("returns the server contract verbatim when present", () => {
    const c = contract({ billing: true });
    expect(
      resolveEffectiveContract(c, { isOfficialOrigin: false, fallback: FALLBACK }),
    ).toBe(c);
  });

  it("synthesizes the hosted posture for an older official server", () => {
    const resolved = resolveEffectiveContract(null, {
      isOfficialOrigin: true,
      fallback: FALLBACK,
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.deployment.mode).toBe("hosted_product");
    expect(resolved?.billing).toBe(true);
    expect(resolved?.cloudWorkspaces).toBe(true);
    expect(resolved?.agentGateway).toBe(true);
    expect(resolved?.webApp.available).toBe(true);
    expect(resolved?.support.email).toBe("support@proliferate.com");
    expect(resolved?.pricing.url).toBe("https://proliferate.com/pricing");
  });

  it("stays null (conservative) for an older non-official server", () => {
    expect(
      resolveEffectiveContract(null, { isOfficialOrigin: false, fallback: FALLBACK }),
    ).toBeNull();
  });

  it("preserves current hosted behavior end to end for an older official server", () => {
    const resolved = resolveEffectiveContract(null, {
      isOfficialOrigin: true,
      fallback: FALLBACK,
    });
    const caps = deriveAppCapabilities({
      reachable: true,
      connectedServerHost: "app.proliferate.com",
      contract: resolved,
    });

    expect(caps.billingEnabled).toBe(true);
    expect(caps.cloudComputeEnabled).toBe(true);
    expect(caps.isSelfManaged).toBe(false);
    expect(caps.serverDisplayName).toBeNull();
  });
});
