// T2-SH-6 (specs/developing/testing/self-hosting.md): cloud-workspace
// provisioning stays safe when E2B is half-configured (E2B_API_KEY set,
// E2B_TEMPLATE_NAME empty, non-debug) — the exact posture that used to raise
// at FastAPI startup and crash-loop the whole control plane, taking auth and
// every other surface down with it (see the module docstring on
// server/proliferate/server/cloud/cloud_sandboxes/service.py and
// server/tests/unit/test_cloud_provisioning_config.py, which owns the pure
// `Settings.cloud_provisioning_config_error` / `require_cloud_provisioning_
// configured()` contract exhaustively).
//
// This is the INTEGRATION layer above that unit test: does the REAL deployed
// process, booted with this exact half-configured posture, (a) actually come
// up healthy instead of crash-looping, and (b) answer a real
// cloud-workspace-create request with the specific, actionable 503 rather
// than a generic 500 or a hang? Both require a live process wired through
// its real startup path (main.py's `lifespan`), which no unit test exercises
// end-to-end.
//
// Ephemeral, server-only boot (no desktop-web, no AnyHarness runtime — a
// route returning a status code needs neither) on its own profile/DB, with
// DEBUG explicitly off: the shared `t2intent` stack always boots DEBUG=true,
// under which `cloud_provisioning_configured` short-circuits true with no
// template at all (debug is meant to make local dev workable without a real
// E2B template) — the wrong posture for a "non-debug half-configured
// production deploy" check. DEBUG=false also requires JWT_SECRET/
// CLOUD_SECRET_KEY to be set to something other than the "CHANGE-ME" defaults
// (config.py's `validate_secrets_in_production`), so this boot sets those too.

import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { bootStack, type BootedStack } from "../stack/boot.ts";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "../stack/seed.ts";

async function claimInstance(stack: BootedStack): Promise<void> {
  const token = readFileSync(stack.setupTokenFile, "utf8").trim();
  const response = await fetch(`${stack.apiBaseUrl}/setup`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      setup_token: token,
      organization_name: "T2 Self-Host Gating",
    }).toString(),
  });
  const html = await response.text();
  if (response.status !== 200) {
    throw new Error(`T2-SH-6: instance claim failed (${response.status}): ${html.slice(0, 300)}`);
  }
}

async function loginOn(baseUrl: string, email: string, password: string): Promise<string> {
  const response = await fetch(`${baseUrl}/auth/desktop/password/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json()) as { access_token?: string };
  if (response.status !== 200 || !body.access_token) {
    throw new Error(`T2-SH-6: login failed for ${email} (${response.status}): ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

test.describe("T2-SH-6: cloud-workspace provisioning stays safe when E2B is half-configured", () => {
  test.setTimeout(180_000);
  let stack: BootedStack;
  let ownerToken: string;

  test.beforeAll(async () => {
    stack = await bootStack({
      profile: "t2e2bgate",
      skipFrontend: true,
      extraServerEnv: {
        DEBUG: "false",
        JWT_SECRET: "t2-sh-6-test-jwt-secret-not-a-real-credential",
        CLOUD_SECRET_KEY: "t2-sh-6-test-cloud-secret-not-a-real-credential",
        E2B_API_KEY: "e2b_half_configured_test_key",
        E2B_TEMPLATE_NAME: "",
      },
    });
    await claimInstance(stack);
    ownerToken = await loginOn(stack.apiBaseUrl, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test.afterAll(async () => {
    await stack?.teardown();
  });

  test("the control plane comes up healthy — half-configured E2B never crash-loops the API", async () => {
    const health = await fetch(`${stack.apiBaseUrl}/health`);
    expect(health.status).toBe(200);
    // Auth and every other base surface stayed reachable — proven by having
    // already claimed + logged in successfully in beforeAll.
    expect(ownerToken.length).toBeGreaterThan(0);
  });

  test("the /meta capability contract already reflects the disabled state, matching what provisioning will actually do", async () => {
    const meta = (await (await fetch(`${stack.apiBaseUrl}/meta`)).json()) as {
      capabilities: { cloudWorkspaces: boolean };
    };
    expect(meta.capabilities.cloudWorkspaces).toBe(false);
  });

  test("a real cloud-workspace-create request gets the actionable 503, not a crash or a generic 500", async () => {
    const response = await fetch(`${stack.apiBaseUrl}/v1/cloud/workspaces`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ gitOwner: "acme", gitRepoName: "widgets", branchName: "main" }),
    });
    const body = (await response.json()) as { detail?: { code?: string; message?: string } };
    expect(response.status).toBe(503);
    expect(body.detail?.code).toBe("e2b_template_not_configured");
    // Actionable (names the missing requirement) and never echoes the secret.
    expect(body.detail?.message ?? "").toContain("E2B_TEMPLATE_NAME");
    expect(body.detail?.message ?? "").not.toContain("e2b_half_configured_test_key");
    // Fires before any repo/GitHub lookup: an arbitrary, nonexistent owner/repo
    // gets the SAME 503, not a 404 cloud_repo_environment_not_found (the error
    // T2-WS-1 pins for a fully-configured server) — the E2B gate runs first,
    // for any account/repo shape, exactly matching require_cloud_provisioning_
    // configured()'s position at the top of create_cloud_workspace_for_user.
  });
});
