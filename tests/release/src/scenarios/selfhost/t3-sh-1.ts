import assert from "node:assert/strict";

import type { ScenarioDefinition, ScenarioRunContext } from "../types.js";
import { ScenarioBlockedError } from "../types.js";
import { ApiClient } from "../../fixtures/http.js";
import {
  provisionSelfHostBox,
  terminateSelfHostBox,
  readSetupTokenOverSsh,
  ssh,
  COMPOSE_OVER_SSH,
  type SelfHostBox,
} from "../../fixtures/selfhost.js";

/**
 * T3-SH-1 — cold boot to second user on real infra.
 * specs/developing/testing/self-hosting.md#T3-SH-1
 *
 * Provisions a FRESH self-hosted control plane on EC2 (production compose
 * bundle on stock Ubuntu, sslip.io hostname, real Caddy-issued TLS), then walks
 * the first-run operator journey through the real proxy path — the same walk as
 * the CI self-host smoke, but over real TLS/DNS and asserting the resulting rows
 * land in the instance's own Postgres ("shows up in the database in AWS"):
 *
 *   /meta version -> read the first-run setup token off the box (never served
 *   over HTTP) -> claim at /setup (claimer becomes owner of the single instance
 *   org) -> /setup permanently 404s -> desktop password login -> invite a
 *   second email -> invitee self-registers with the invitation token -> invitee
 *   login -> both are active members of the one instance org -> the "user" and
 *   organization_membership tables each hold the expected rows.
 *
 * Cost-gated behind RELEASE_E2E_SELFHOST_PROVISION (declared requiredEnv, so the
 * runner reports it blocked — never red — when the opt-in is absent). Terminates
 * the box (and its throwaway SG + key pair) in a finally.
 */

// Passwords must satisfy the server's 12-character minimum.
const ADMIN_PASSWORD = "proliferate-e2e-admin-1";
const INVITEE_PASSWORD = "proliferate-e2e-invitee-1";

interface OrganizationsResponse {
  organizations: Array<{ id: string; membership?: { status?: string; role?: string } }>;
}

interface InvitationResponse {
  id: string;
  status: string;
}

interface MembersResponse {
  members: Array<{ email: string; status: string; role: string }>;
}

export const t3Sh1: ScenarioDefinition = {
  id: "T3-SH-1",
  title: "cold boot to second user on real self-hosted infra",
  registryFlowRef: "specs/developing/testing/self-hosting.md#T3-SH-1",
  lanes: ["local"],
  requiredEnv: ["RELEASE_E2E_SELFHOST_PROVISION"],
  plan: () => [
    { description: "provision a fresh self-hosted box (compose bundle on EC2, sslip.io + real TLS)" },
    { description: "GET /meta over real TLS: a real serverVersion (not the 0.1.0 hardcode)" },
    { description: "read the first-run setup token from the api container over SSH" },
    { description: "claim the instance at /setup; assert the success page and that /setup then 404s" },
    { description: "GET /auth/desktop/methods advertises password login; the admin logs in" },
    { description: "admin owns exactly one active instance org" },
    { description: "admin invites a second email; the invitation is pending" },
    { description: "invitee self-registers with the invitation token, then logs in" },
    { description: "both users are active members of the one instance org" },
    { description: "assert the rows landed in the instance Postgres (\"user\" + organization_membership)" },
    { description: "terminate the box (finally)" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    if (process.env.RELEASE_E2E_SELFHOST_PROVISION?.trim() !== "1") {
      throw new ScenarioBlockedError(
        "T3-SH-1: provisioning a fresh self-hosted EC2 box costs real infra. Set " +
          "RELEASE_E2E_SELFHOST_PROVISION=1 (with AWS creds able to run-instances + create a throwaway " +
          "SG/key pair in the default VPC) to run it for real. Not set — refusing to provision.",
      );
    }
    await runReal();
  },
};

async function runReal(): Promise<void> {
  const box = await provisionSelfHostBox("stable");
  try {
    const adminEmail = `admin-${box.instanceId}@proliferate-releasee2e.dev`;
    const inviteeEmail = `invitee-${box.instanceId}@proliferate-releasee2e.dev`;
    const client = new ApiClient({ baseUrl: box.url });

    // /meta over real TLS.
    const meta = await client.get<{ serverVersion?: string }>("/meta");
    assert.ok(
      meta.serverVersion && meta.serverVersion !== "0.1.0",
      `T3-SH-1: expected a real /meta serverVersion, got ${JSON.stringify(meta.serverVersion)}`,
    );
    console.log(`[T3-SH-1] ${box.url} serverVersion=${meta.serverVersion}`);

    // Claim.
    const setupToken = await readSetupTokenOverSsh(box);
    assert.ok(setupToken.length > 0, "T3-SH-1: could not read the first-run setup token off the box");
    await claim(box.url, adminEmail, ADMIN_PASSWORD, setupToken);
    const reclaim = await fetch(`${box.url}/setup`);
    assert.equal(reclaim.status, 404, `T3-SH-1: /setup should 404 after claim, got ${reclaim.status}`);
    console.log("[T3-SH-1] claimed; /setup now 404s");

    // Adaptive sign-in + admin login.
    const methods = await client.get<{ password_login?: boolean }>("/auth/desktop/methods");
    assert.equal(methods.password_login, true, "T3-SH-1: password login should be advertised");
    const adminToken = await desktopLogin(box.url, adminEmail, ADMIN_PASSWORD);
    const adminClient = client.withBearerToken(adminToken);

    // Admin owns exactly one active instance org.
    const adminOrgs = await adminClient.get<OrganizationsResponse>("/v1/organizations");
    assert.equal(adminOrgs.organizations.length, 1, "T3-SH-1: admin should belong to exactly one org");
    const orgId = adminOrgs.organizations[0].id;
    assert.equal(adminOrgs.organizations[0].membership?.status, "active", "T3-SH-1: admin membership not active");
    assert.equal(adminOrgs.organizations[0].membership?.role, "owner", "T3-SH-1: claimer should be org owner");

    // Invite -> register -> invitee login.
    const invitation = await adminClient.post<InvitationResponse>(
      `/v1/organizations/${orgId}/invitations`,
      { email: inviteeEmail, role: "member" },
    );
    assert.equal(invitation.status, "pending", "T3-SH-1: invitation should be pending");
    await client.post("/auth/password/register", {
      email: inviteeEmail,
      password: INVITEE_PASSWORD,
      invitationToken: invitation.id,
    });
    const inviteeToken = await desktopLogin(box.url, inviteeEmail, INVITEE_PASSWORD);
    const inviteeOrgs = await client.withBearerToken(inviteeToken).get<OrganizationsResponse>("/v1/organizations");
    assert.equal(inviteeOrgs.organizations.length, 1, "T3-SH-1: invitee should belong to exactly one org");
    assert.equal(inviteeOrgs.organizations[0].id, orgId, "T3-SH-1: invitee joined the wrong org");

    // Both active members.
    const members = await adminClient.get<MembersResponse>(`/v1/organizations/${orgId}/members`);
    for (const email of [adminEmail, inviteeEmail]) {
      assert.ok(
        members.members.some((m) => m.email === email && m.status === "active"),
        `T3-SH-1: ${email} is not an active member: ${JSON.stringify(members.members)}`,
      );
    }
    console.log("[T3-SH-1] both users are active members of the instance org");

    // The rows actually landed in the instance's own Postgres. Two users (admin
    // + invitee) and two memberships prove the whole journey persisted; the API
    // asserts above already confirmed the invitee's email + active membership.
    const userCount = await psqlScalar(box, 'select count(*) from "user"');
    const membershipCount = await psqlScalar(box, "select count(*) from organization_membership");
    assert.equal(userCount, "2", `T3-SH-1: expected 2 users in Postgres, got ${userCount}`);
    assert.equal(membershipCount, "2", `T3-SH-1: expected 2 memberships in Postgres, got ${membershipCount}`);
    console.log(`[T3-SH-1] Postgres: users=${userCount} memberships=${membershipCount} (verified in AWS)`);
  } finally {
    await terminateSelfHostBox(box);
  }
}

async function claim(baseUrl: string, email: string, password: string, setupToken: string): Promise<void> {
  const body = new URLSearchParams({ email, password, setup_token: setupToken });
  const response = await fetch(`${baseUrl}/setup`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await response.text();
  assert.ok(response.ok, `T3-SH-1: /setup claim failed ${response.status}: ${text.slice(0, 200)}`);
  assert.ok(text.includes("You are all set"), "T3-SH-1: claim did not render the setup success page");
}

async function desktopLogin(baseUrl: string, email: string, password: string): Promise<string> {
  const client = new ApiClient({ baseUrl });
  const res = await client.post<{ access_token?: string; accessToken?: string }>(
    "/auth/desktop/password/login",
    { email, password },
  );
  const token = res.access_token ?? res.accessToken;
  assert.ok(token, `T3-SH-1: desktop login for ${email} returned no access token`);
  return token;
}

async function psqlScalar(box: SelfHostBox, query: string): Promise<string> {
  const out = await ssh(
    box,
    `cd ~/proliferate/deploy && ${COMPOSE_OVER_SSH} exec -T db psql -U proliferate -d proliferate -tAc '${query}'`,
  );
  return out.trim();
}
