// Shared bootstrap for the billing specs: the admin / org handles every
// scenario builds on. Required Stripe configuration is validated by global
// setup before Playwright starts any test.

import { test as base } from "@playwright/test";

import {
  ADMIN_EMAIL,
  ADMIN_ORG_NAME,
  ADMIN_PASSWORD,
  assertNoOauthAccountRows,
  ensureInstanceClaimed,
  passwordLogin,
} from "../../stack/seed.ts";

export interface AdminContext {
  token: string;
  organizationId: string;
}

let cached: AdminContext | null = null;

/** The claimed single-org admin + its org id, shared across billing specs.
 * Idempotent: the first spec to call it claims the instance. */
export async function adminContext(): Promise<AdminContext> {
  if (cached) {
    return cached;
  }
  await ensureInstanceClaimed();
  const { access_token } = await passwordLogin(ADMIN_EMAIL, ADMIN_PASSWORD);
  // Pin the INSTANCE org (by its claimed name), not organizations[0]: the
  // team-checkout scenarios activate additional orgs for this same admin, and
  // invited self-registration (/register) only accepts invitations for the
  // instance org — inviting into a team org would 403 every later register.
  const response = await fetch(`${process.env.TIER2_BILLING_API_BASE_URL}/v1/organizations`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const listing = (await response.json()) as { organizations: Array<{ id: string; name: string }> };
  const org =
    listing.organizations.find((o) => o.name === ADMIN_ORG_NAME) ?? listing.organizations[0];
  // Single-org mode deliberately admits its claimed password owner without a
  // GitHub identity. Pin that supported self-host posture instead of forging
  // a legacy OAuth row to satisfy hosted-product readiness.
  const meResponse = await fetch(`${process.env.TIER2_BILLING_API_BASE_URL}/users/me`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const me = (await meResponse.json()) as { id: string };
  await assertNoOauthAccountRows(me.id);
  cached = { token: access_token, organizationId: org.id };
  return cached;
}

/** The admin user's own user id (owner of the personal billing subject). */
export async function adminUserId(): Promise<string> {
  const { token } = await adminContext();
  const response = await fetch(`${process.env.TIER2_BILLING_API_BASE_URL}/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await response.json()) as { id: string };
  return body.id;
}

export { base as test };
