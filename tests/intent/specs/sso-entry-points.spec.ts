// T2-AUTH-5 (specs/developing/testing/scenarios.md): org-scoped SSO login
// entry points.
//
// PR #1048 added the user-facing ways *in* to org SSO (the backend OIDC flow
// already existed): a slug login page (`/login`, `/login/<slug>`), a "Sign in
// with SSO" affordance on cold login, and `/join/<orgId>` web sign-in. Every
// one of them resolves an org **slug or id** to that org's SSO connection
// through `GET /auth/sso/discover`, then hands off to the existing start flow.
//
// This spec owns the ENTRY-POINT seam, not the OIDC round-trip. The round-trip
// (mock IdP → callback → linked user + JIT membership) is T2-AUTH-3, landed
// separately (PR #1015); duplicating it here would be redundant and would drag
// a live IdP into a flow that does not need one. Discover reads the
// connection's stored state only — it never contacts the IdP — so the
// resolution seam is fully assertable without one:
//   - negative: an unknown slug, and an existing org that has no SSO, must
//     return the *same* generic answer (`enabled:false`, `reason:
//     "not_available"`, no ids) so slugs cannot be cycled to enumerate which
//     orgs exist or have SSO;
//   - positive: a slug (and an org id, the `/join` path's input) that resolves
//     to an ENABLED connection returns exactly the ids the start flow needs
//     (`organizationId`, `connectionId`, `protocol`, `displayName`) — this is
//     the entry point's whole job;
//   - truthfulness (self-hosting-relevant, specs/developing/testing/self-
//     hosting.md): a connection whose `status` is 'enabled' but whose OIDC
//     config drifted incomplete afterwards (an admin edit, not something the
//     enable endpoint itself can produce) must still report `enabled:false`
//     with the specific reason — never a false positive that would render a
//     sign-in button that can only fail at the provider.
//
// Surface coverage note (honest tier boundary): the tier-2 stack serves the
// **desktop web build** (`apps/desktop`, see stack/boot.ts), so the desktop
// entry point (`OrgSsoLoginLink` on `/login`) is driven through a real browser
// below. The `apps/web` pages (`LoginSsoPage`, the auth-screen link, the
// `/join` page) are a *different* Vite app this harness does not boot; their
// logic sits on the identical `discoverSso` seam, which the server-level cases
// here pin directly. If a web-app browser lane is added to this suite later,
// the rendered `apps/web` pages get their own rows on top of this same seam.

import { expect, test, type Page } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  apiBaseUrl,
  deleteOrgSsoConnections,
  ensureInstanceClaimed,
  getOrganizationSlug,
  getOwnOrganization,
  passwordLogin,
  seedEnabledOrgSsoConnection,
  seedIncompleteEnabledOrgSsoConnection,
  webBaseUrl,
} from "../stack/seed.ts";

test.describe.configure({ mode: "serial" });

interface SsoDiscoveryResponse {
  enabled: boolean;
  scope: "deployment" | "organization" | null;
  connectionId: string | null;
  organizationId: string | null;
  protocol: "oidc" | "saml" | null;
  displayName: string | null;
  reason: string | null;
}

async function discover(query: Record<string, string>): Promise<{ status: number; body: SsoDiscoveryResponse }> {
  const params = new URLSearchParams(query).toString();
  const response = await fetch(`${apiBaseUrl()}/auth/sso/discover?${params}`);
  return { status: response.status, body: (await response.json()) as SsoDiscoveryResponse };
}

// Every test needs the instance claimed (so the admin org — our
// existing-but-no-SSO subject — exists) and the admin org's id/slug.
let organizationId: string;
let organizationSlug: string;

test.beforeAll(async () => {
  await ensureInstanceClaimed();
  const adminToken = (await passwordLogin(ADMIN_EMAIL, ADMIN_PASSWORD)).access_token;
  organizationId = (await getOwnOrganization(adminToken)).id;
  organizationSlug = await getOrganizationSlug(organizationId);
});

// The seeded connection must never outlive this file — sibling specs share
// this profile's DB and none of them expects an org SSO connection to exist.
test.afterAll(async () => {
  await deleteOrgSsoConnections(organizationId);
});

test.describe("T2-AUTH-5: org SSO entry points — discover seam", () => {
  test("unknown slug returns the generic not-available answer with no ids", async () => {
    const { status, body } = await discover({ slug: "no-such-workspace-2f1a9c" });
    expect(status).toBe(200);
    expect(body.enabled).toBe(false);
    expect(body.reason).toBe("not_available");
    // No ids leak — the caller cannot tell this slug from a real one.
    expect(body.organizationId).toBeNull();
    expect(body.connectionId).toBeNull();
    expect(body.protocol).toBeNull();
    expect(body.displayName).toBeNull();
  });

  test("an existing org with no SSO returns the identical answer (no enumeration)", async () => {
    // The admin org is real and its slug resolves to it, but it has no SSO —
    // the response must be byte-for-byte the unknown-slug answer, or a caller
    // could cycle slugs to learn which orgs exist / have SSO configured.
    const { body } = await discover({ slug: organizationSlug });
    expect(body.enabled).toBe(false);
    expect(body.reason).toBe("not_available");
    expect(body.organizationId).toBeNull();
    expect(body.connectionId).toBeNull();
  });

  test("a slug resolving to an enabled connection returns exactly the start ids", async () => {
    const connectionId = await seedEnabledOrgSsoConnection(organizationId, "Acme Okta");
    try {
      const { status, body } = await discover({ slug: organizationSlug });
      expect(status).toBe(200);
      expect(body.enabled).toBe(true);
      expect(body.organizationId).toBe(organizationId);
      expect(body.connectionId).toBe(connectionId);
      expect(body.protocol).toBe("oidc");
      expect(body.scope).toBe("organization");
      expect(body.displayName).toBe("Acme Okta");
      // reason is only set on the not-available answers.
      expect(body.reason).toBeNull();
    } finally {
      await deleteOrgSsoConnections(organizationId);
    }
  });

  test("the /join path's org-id discovery resolves the same enabled connection", async () => {
    // `/join/<orgId>` discovers by organization id (not slug) and signs the
    // user in on the web when SSO is enabled, else falls back to the Desktop
    // handoff. Both branches are decided by this discover answer.
    const connectionId = await seedEnabledOrgSsoConnection(organizationId, "Acme Okta");
    try {
      const enabled = await discover({ organizationId });
      expect(enabled.body.enabled).toBe(true);
      expect(enabled.body.connectionId).toBe(connectionId);
    } finally {
      await deleteOrgSsoConnections(organizationId);
    }

    // With no connection, the same org-id lookup reports SSO unavailable — the
    // signal that makes `/join` fall back to the Desktop handoff.
    const disabled = await discover({ organizationId });
    expect(disabled.body.enabled).toBe(false);
  });

  test("truthfulness: a connection marked enabled but missing required OIDC config still reports enabled=false, with the specific reason (not a false positive)", async () => {
    // enable_organization_sso_connection (server/proliferate/server/
    // organizations/sso/service.py) re-tests the live OIDC endpoints before
    // ever flipping status to 'enabled', so the product's own admin API can
    // never produce this row. It happens anyway: update_organization_sso_
    // connection lets an admin clear oidc_client_id afterwards with no
    // re-validation and no automatic revert to disabled. If discover trusted
    // status alone, the desktop would render a working-looking "Sign in with
    // SSO" button that could only fail at the provider — this is exactly the
    // regression discover's oidc_configuration_error gate exists to prevent.
    const connectionId = await seedIncompleteEnabledOrgSsoConnection(organizationId);
    try {
      // Query by organization id (the /join path's shape), not slug: the slug
      // wrapper collapses every non-enabled outcome to the same generic
      // "not_available" answer (see the enumeration-safety tests above), which
      // would hide the distinct reason this test exists to pin.
      const { status, body } = await discover({ organizationId });
      expect(status).toBe(200);
      expect(body.enabled).toBe(false);
      expect(body.reason).toBe("oidc_client_id_missing");
      // Unlike the "no SSO at all" answers, this connection is real — discover
      // is allowed to say so (organizationId/connectionId are not secrets and
      // the caller already knows this org exists); it just must never claim
      // the connection is usable.
      expect(body.connectionId).toBe(connectionId);
      expect(body.protocol).toBe("oidc");

      // The slug path (the desktop cold-login affordance's actual input) must
      // collapse this to the same non-enumerating answer as "no SSO at all" —
      // it is unavailable either way, and the two must be indistinguishable
      // from a caller cycling slugs.
      const bySlug = await discover({ slug: organizationSlug });
      expect(bySlug.body.enabled).toBe(false);
      expect(bySlug.body.reason).toBe("not_available");
      expect(bySlug.body.connectionId).toBeNull();
    } finally {
      await deleteOrgSsoConnections(organizationId);
    }
  });
});

// The desktop web build's cold-login SSO affordance (OrgSsoLoginLink on
// `/login`). We drive the negative through a real browser: it exercises the
// entry point end-to-end (expand → slug → discover → generic error) without
// needing a live IdP, since an unavailable slug never reaches the start flow.
async function openSsoAffordance(page: Page): Promise<void> {
  await page.goto(`${webBaseUrl()}/login`);
  const link = page.getByRole("button", { name: "Sign in with SSO" });
  await expect(link).toBeVisible({ timeout: 30_000 });
  await link.click();
  await expect(page.getByPlaceholder("your-organization")).toBeVisible();
}

test.describe("T2-AUTH-5: org SSO entry points — desktop cold-login affordance", () => {
  test("the affordance reveals a slug field and a Continue action", async ({ page }) => {
    await openSsoAffordance(page);
    await expect(page.getByRole("button", { name: /Continue with SSO/i })).toBeVisible();
  });

  test("an unknown slug surfaces the generic error and does not start SSO", async ({ page }) => {
    await openSsoAffordance(page);
    await page.getByPlaceholder("your-organization").fill("no-such-workspace-2f1a9c");
    await page.getByRole("button", { name: /Continue with SSO/i }).click();
    // The generic, non-enumerating message the hook shows for any unavailable
    // slug (missing org, no SSO, or disabled all collapse to this).
    await expect(page.getByText(/sign-in link your admin shared/i)).toBeVisible({ timeout: 15_000 });
    // Still on the login surface — no navigation/kickoff happened.
    await expect(page.getByPlaceholder("your-organization")).toBeVisible();
  });

  test("an existing org with no SSO shows the same generic error (no enumeration)", async ({ page }) => {
    await openSsoAffordance(page);
    await page.getByPlaceholder("your-organization").fill(organizationSlug);
    await page.getByRole("button", { name: /Continue with SSO/i }).click();
    await expect(page.getByText(/sign-in link your admin shared/i)).toBeVisible({ timeout: 15_000 });
  });
});
