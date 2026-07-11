// T2-POL-1: real server + desktop-web policy journey. The dedicated profile
// enables the gateway product surface but never calls a model/provider or
// starts an AnyHarness turn; those execution proofs remain Tier 3.

import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { bootStack, type BootedStack } from "../stack/boot.ts";

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const OWNER_EMAIL = "owner@t2policy.example.com";
const OWNER_PASSWORD = "T2PolicyOwner!Passw0rd";
const MEMBER_PASSWORD = "T2PolicyMember!Passw0rd";
const POLICY_PROFILE =
  process.env.TIER2_AGENT_POLICY_PROFILE
  ?? `${process.env.TIER2_INTENT_PROFILE ?? "t2intent"}-policy`;

interface ApiResult<T> {
  status: number;
  body: T;
}

interface PolicyResponse {
  organizationId: string;
  allowedRoutes: string[] | null;
  allowedHarnesses: string[] | null;
  editable: boolean;
}

let stack: BootedStack;
let ownerToken: string;
let memberToken: string;
let memberEmail: string;
let organizationId: string;

test.beforeAll(async () => {
  // A cold local database migration may contend with other worktrees. This is
  // stack setup, not the product-flow latency budget exercised below.
  test.setTimeout(600_000);
  stack = await bootStack({
    profile: POLICY_PROFILE,
    skipRuntime: true,
    // The main suite globalSetup has already built these artifacts before it
    // starts this worker; rebuilding all packages here can exceed hook timeouts.
    skipFrontendBuild: true,
    extraServerEnv: {
      AGENT_GATEWAY_ENABLED: "true",
      AGENT_GATEWAY_POLICY_MIN_PLAN: "free",
    },
  });
  await claimPolicyInstance();
  ownerToken = await login(OWNER_EMAIL, OWNER_PASSWORD);
  const organizations = await api<{ organizations: Array<{ id: string }> }>(
    "/v1/organizations",
    { token: ownerToken },
  );
  expect(organizations.status).toBe(200);
  organizationId = organizations.body.organizations[0].id;
  memberEmail = `member-${Date.now()}@t2policy.example.com`;
  memberToken = await inviteAndRegisterMember(memberEmail);
});

test.afterAll(async () => {
  await stack?.teardown();
});

const policyPath = () =>
  `/v1/cloud/organizations/${organizationId}/agent-gateway/policy`;

test.describe("T2-POL-1: organization agent policy", () => {
  test("owner can normalize the policy while a member cannot read or mutate it", async () => {
    const normalized = await api<PolicyResponse>(policyPath(), {
      method: "PUT",
      token: ownerToken,
      body: { allowedRoutes: null, allowedHarnesses: null },
    });
    expect(normalized.status).toBe(200);
    expect(normalized.body).toMatchObject({
      organizationId,
      allowedRoutes: null,
      allowedHarnesses: null,
      editable: true,
    });

    const memberRead = await api(policyPath(), { token: memberToken });
    expect(memberRead.status).toBe(403);
    const memberWrite = await api(policyPath(), {
      method: "PUT",
      token: memberToken,
      body: { allowedRoutes: ["gateway"] },
    });
    expect(memberWrite.status).toBe(403);
  });

  test("a pre-existing member selection becomes a visible conflict after the owner saves through desktop-web", async ({ page }) => {
    const seeded = await api("/v1/cloud/agent-gateway/selections/codex?surface=cloud", {
      method: "PUT",
      token: memberToken,
      body: { sources: [{ sourceKind: "gateway", enabled: true }] },
    });
    expect(seeded.status).toBe(200);

    await page.goto(stack.webBaseUrl);
    await page.getByLabel("Email").fill(OWNER_EMAIL);
    await page.getByLabel("Password").fill(OWNER_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByLabel("Password")).toHaveCount(0, { timeout: 30_000 });

    await page.goto(`${stack.webBaseUrl}/settings?section=organization-model-policy`);
    await expect(page.getByRole("heading", { name: "Model policy" })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Codex" })).toBeChecked();
    await expect(page.getByRole("switch", { name: "Gateway" })).toBeChecked();
    await page.getByRole("switch", { name: "Codex" }).click();
    await page.getByRole("switch", { name: "Gateway" }).click();
    await page.getByRole("button", { name: "Save policy" }).click();

    await expect
      .poll(async () => (await api<PolicyResponse>(policyPath(), { token: ownerToken })).body)
      .toMatchObject({
        allowedRoutes: ["native", "api_key"],
        allowedHarnesses: ["claude", "opencode", "gemini", "grok"],
      });
    await expect(page.getByText(memberEmail)).toBeVisible();
    await expect(page.getByRole("cell", { name: "Codex" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Gateway" })).toBeVisible();
  });

  test("new disallowed selections fail closed, while clearing stale state remains allowed", async () => {
    const blocked = await api<{ detail?: { code?: string } }>(
      "/v1/cloud/agent-gateway/selections/codex?surface=cloud",
      {
        method: "PUT",
        token: memberToken,
        body: { sources: [{ sourceKind: "gateway", enabled: true }] },
      },
    );
    expect(blocked.status).toBe(403);
    expect(blocked.body.detail?.code).toBe("policy_violation");

    const cleared = await api("/v1/cloud/agent-gateway/selections/codex?surface=cloud", {
      method: "PUT",
      token: memberToken,
      body: { sources: [] },
    });
    expect(cleared.status).toBe(200);

    await expect
      .poll(async () => {
        const result = await api<{ violations: unknown[] }>(`${policyPath()}/violations`, {
          token: ownerToken,
        });
        return result.body.violations.length;
      })
      .toBe(0);
  });
});

async function claimPolicyInstance(): Promise<void> {
  if ((await fetch(`${stack.apiBaseUrl}/setup`)).status === 404) {
    return;
  }
  const response = await fetch(`${stack.apiBaseUrl}/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      email: OWNER_EMAIL,
      password: OWNER_PASSWORD,
      setup_token: readFileSync(stack.setupTokenFile, "utf8").trim(),
      organization_name: "Tier 2 Policy Org",
    }),
  });
  expect(response.status).toBe(200);
}

async function inviteAndRegisterMember(email: string): Promise<string> {
  const invitation = await api<{ id: string }>(
    `/v1/organizations/${organizationId}/invitations`,
    { method: "POST", token: ownerToken, body: { email, role: "member" } },
  );
  expect([200, 201]).toContain(invitation.status);
  const registration = await fetch(`${stack.apiBaseUrl}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      email,
      password: MEMBER_PASSWORD,
      invitation_token: invitation.body.id,
    }),
  });
  expect(registration.status).toBe(200);
  return login(email, MEMBER_PASSWORD);
}

async function login(email: string, password: string): Promise<string> {
  let last: ApiResult<{ access_token?: string }> | undefined;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    last = await api<{ access_token?: string }>("/auth/desktop/password/login", {
      method: "POST",
      body: { email, password },
    });
    if (last.status === 200 && last.body.access_token) {
      return last.body.access_token;
    }
    // `/setup` and `/register` commit in dependency teardown, just after the
    // response body is written. Only absorb that known first-read 401 window;
    // every other response is a real failure and stops immediately.
    if (last.status !== 401) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  expect(last?.status, `password login failed: ${JSON.stringify(last?.body)}`).toBe(200);
  throw new Error("password login returned no access token");
}

async function api<T = unknown>(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const response = await fetch(`${stack.apiBaseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: (text ? JSON.parse(text) : undefined) as T,
  };
}
