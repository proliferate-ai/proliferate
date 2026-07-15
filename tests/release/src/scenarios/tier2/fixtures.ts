/**
 * Shared admin/org handle for Tier-2 cell handlers (PR 4, workstream D).
 *
 * Adapted from `tests/intent/specs/billing/_fixtures.ts`'s `adminContext` /
 * `adminUserId` — same claim-once-and-reuse idempotency, minus the Playwright
 * `test.beforeAll` skip wiring (the harness already returns every financial
 * cell `blocked` when Stripe is unresolved; a case handler only runs once the
 * stack is booted for real). One process runs every case against the ONE
 * booted stack (BRIEF §1), so the module-level cache is exactly the intended
 * "claim once, reuse" behavior across cases in a run.
 */

import {
  ADMIN_EMAIL,
  ADMIN_ORG_NAME,
  ADMIN_PASSWORD,
  ensureInstanceClaimed,
  passwordLogin,
} from "../../../../intent/stack/seed.ts";
import { ensureProductReady } from "../../../../intent/stack/billing-seed.ts";

export interface AdminContext {
  token: string;
  organizationId: string;
  userId: string;
}

let cached: AdminContext | null = null;

/** The claimed single-org admin + its org id + user id, shared across cases in
 * this run. Idempotent: the first case to call it claims the instance. */
export async function adminContext(): Promise<AdminContext> {
  if (cached) {
    return cached;
  }
  await ensureInstanceClaimed();
  const { access_token } = await passwordLogin(ADMIN_EMAIL, ADMIN_PASSWORD);
  const apiBaseUrl = required("TIER2_BILLING_API_BASE_URL");
  const orgResponse = await fetch(`${apiBaseUrl}/v1/organizations`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const listing = (await orgResponse.json()) as { organizations: Array<{ id: string; name: string }> };
  const org = listing.organizations.find((o) => o.name === ADMIN_ORG_NAME) ?? listing.organizations[0];
  const meResponse = await fetch(`${apiBaseUrl}/users/me`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const me = (await meResponse.json()) as { id: string };
  // Billing/product surfaces sit behind the GitHub product-readiness gate even
  // in single-org mode; this boot is password-only, so seed the legacy
  // GitHub link the gate accepts (see ensureProductReady's doc).
  await ensureProductReady(me.id, ADMIN_EMAIL);
  cached = { token: access_token, organizationId: org.id, userId: me.id };
  return cached;
}

/** Test-only reset hook: clears the cached admin handle. Not called by
 * production case flow (accounts survive `resetBillingState()` by design);
 * exposed for the harness/evidence unit tests to exercise in isolation. */
export function resetAdminContextCacheForTests(): void {
  cached = null;
}

export async function userIdFor(token: string): Promise<string> {
  const apiBaseUrl = required("TIER2_BILLING_API_BASE_URL");
  const response = await fetch(`${apiBaseUrl}/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await response.json()) as { id: string };
  return body.id;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — did the Tier-2 stack boot?`);
  }
  return value;
}
