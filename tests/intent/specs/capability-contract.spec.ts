// T2-SH-5 (specs/developing/testing/self-hosting.md): the /meta capability
// contract, asserted against REAL running servers.
//
// server/tests/unit/test_meta_endpoint.py already owns the pure
// `build_server_capabilities(Settings)` contract exhaustively (every field,
// every posture, hosted vs self-managed vs add-ons-on). This is the
// INTEGRATION layer above it: does the actual deployed process — real env
// vars parsed by pydantic-settings, the real global `settings` singleton,
// the real `/meta` route, real JSON over the wire — produce the same
// contract for real? That plumbing (env -> Settings -> route -> response) is
// exactly what a rename, a missed wiring, or an env-var typo in
// `server/deploy/**` would break, and no unit test can see it because it
// never boots the process.
//
// Two ephemeral, server-only boots (no desktop-web, no AnyHarness runtime —
// `/meta` needs neither), each on its own profile/DB so this file never
// shares state with the default `t2intent` stack or any sibling spec:
//  - self-managed, every add-on off — the actual posture every self-hosted
//    operator gets by default.
//  - hosted mode, every add-on on — the contrast case, proving the same
//    plumbing flips every boolean correctly rather than just "always false".
//
// Mirrors stack/billing-global-setup.ts's "dedicated profile for a different
// server posture" pattern, scoped to this one file's beforeAll/afterAll
// instead of a whole second Playwright project (no Stripe, no browser, no UI
// needed here).

import { expect, test } from "@playwright/test";
import { bootStack, type BootedStack } from "../stack/boot.ts";

const PROFILE_PREFIX = process.env.TIER2_INTENT_PROFILE ?? "t2intent";
const SELF_MANAGED_PROFILE = `${PROFILE_PREFIX}-cap-self`;
const HOSTED_PROFILE = `${PROFILE_PREFIX}-cap-hosted`;

interface MetaResponse {
  serverVersion: string;
  capabilities: {
    deployment: { mode: string; displayName: string; logoUrl: string | null };
    billing: boolean;
    usageMetering: boolean;
    cloudWorkspaces: boolean;
    agentGateway: boolean;
    webApp: { available: boolean; baseUrl: string | null };
    support: { kind: string; email: string | null; url: string | null };
    pricing: { available: boolean; url: string | null };
  };
}

async function fetchMeta(baseUrl: string): Promise<MetaResponse> {
  const response = await fetch(`${baseUrl}/meta`);
  expect(response.status).toBe(200);
  return (await response.json()) as MetaResponse;
}

test.describe("T2-SH-5: /meta capability contract — self-managed, every add-on off", () => {
  test.setTimeout(180_000);
  let stack: BootedStack;

  test.beforeAll(async () => {
    // Cold migrations for a nested profile are setup work, not the latency
    // budget of the /meta assertion below.
    test.setTimeout(600_000);
    stack = await bootStack({
      profile: SELF_MANAGED_PROFILE,
      skipFrontend: true,
      extraServerEnv: {
        TELEMETRY_MODE: "self_managed",
        CLOUD_BILLING_MODE: "off",
        AGENT_GATEWAY_ENABLED: "false",
        E2B_API_KEY: "",
        E2B_TEMPLATE_NAME: "",
        FRONTEND_BASE_URL: "",
        INSTANCE_NAME: "",
        INSTANCE_LOGO_URL: "",
        INSTANCE_SUPPORT_EMAIL: "",
        INSTANCE_SUPPORT_URL: "",
      },
    });
  });

  test.afterAll(async () => {
    await stack?.teardown();
  });

  test("advertises every capability false, no vendor support/pricing, and the operator's own deployment identity", async () => {
    const meta = await fetchMeta(stack.apiBaseUrl);
    expect(meta.capabilities.deployment.mode).toBe("self_managed");
    // No INSTANCE_NAME configured -> empty, so the desktop falls back to the
    // connected origin rather than mislabeling this as the vendor product.
    expect(meta.capabilities.deployment.displayName).toBe("");
    expect(meta.capabilities.billing).toBe(false);
    expect(meta.capabilities.usageMetering).toBe(false);
    expect(meta.capabilities.cloudWorkspaces).toBe(false);
    expect(meta.capabilities.agentGateway).toBe(false);
    expect(meta.capabilities.webApp.available).toBe(false);
    expect(meta.capabilities.webApp.baseUrl).toBeNull();
    // No operator support email/url configured -> no support affordance at all.
    expect(meta.capabilities.support.kind).toBe("none");
    expect(meta.capabilities.support.email).toBeNull();
    expect(meta.capabilities.pricing.available).toBe(false);
  });
});

test.describe("T2-SH-5: /meta capability contract — hosted mode advertises full caps", () => {
  test.setTimeout(180_000);
  let stack: BootedStack;

  test.beforeAll(async () => {
    test.setTimeout(600_000);
    stack = await bootStack({
      profile: HOSTED_PROFILE,
      skipFrontend: true,
      extraServerEnv: {
        TELEMETRY_MODE: "hosted_product",
        CLOUD_BILLING_MODE: "enforce",
        AGENT_GATEWAY_ENABLED: "true",
        E2B_API_KEY: "e2b_capability_contract_test_placeholder",
        E2B_TEMPLATE_NAME: "proliferate-runtime-cloud",
        FRONTEND_BASE_URL: "https://web.proliferate.example.test",
      },
    });
  });

  test.afterAll(async () => {
    await stack?.teardown();
  });

  test("advertises every capability true, vendor support, and vendor pricing", async () => {
    const meta = await fetchMeta(stack.apiBaseUrl);
    expect(meta.capabilities.deployment.mode).toBe("hosted_product");
    expect(meta.capabilities.billing).toBe(true);
    expect(meta.capabilities.usageMetering).toBe(true);
    expect(meta.capabilities.cloudWorkspaces).toBe(true);
    expect(meta.capabilities.agentGateway).toBe(true);
    expect(meta.capabilities.webApp.available).toBe(true);
    expect(meta.capabilities.webApp.baseUrl).toBe("https://web.proliferate.example.test");
    expect(meta.capabilities.support.kind).toBe("vendor");
    expect(meta.capabilities.pricing.available).toBe(true);
  });
});
