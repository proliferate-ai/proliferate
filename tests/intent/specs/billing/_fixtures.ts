// Shared bootstrap for the billing specs: the skip guard (no Stripe test key
// → whole suite skips, matching the provisional CI posture) and the admin /
// org handles every scenario builds on.

import { test as base } from "@playwright/test";

import {
  ADMIN_EMAIL,
  ADMIN_ORG_NAME,
  ADMIN_PASSWORD,
  ensureInstanceClaimed,
  passwordLogin,
} from "../../stack/seed.ts";
import { ensureProductReady } from "../../stack/billing-seed.ts";

export const billingSkipReason = (): string | null => process.env.TIER2_BILLING_SKIP ?? null;

/** Guard every billing describe-block: `test.skip(...)` in a `beforeAll` marks
 * the group skipped (not failed) when the stack was never booted. */
export function skipIfNoStripe(test: typeof base): void {
  test.beforeAll(() => {
    const reason = billingSkipReason();
    test.skip(reason !== null, `billing suite skipped: ${reason}`);
  });
}

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
  // Billing/product surfaces sit behind the GitHub product-readiness gate
  // even in single-org mode; this boot is password-only, so seed the legacy
  // GitHub link the gate accepts (see ensureProductReady's doc).
  const meResponse = await fetch(`${process.env.TIER2_BILLING_API_BASE_URL}/users/me`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const me = (await meResponse.json()) as { id: string };
  await ensureProductReady(me.id, ADMIN_EMAIL);
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
