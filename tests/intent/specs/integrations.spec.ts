// T2-INT-1 (specs/developing/testing/scenarios.md): api_key connect + org
// policy toggle.
//
// Scenario, per the 2026-07-08 ruling baked into scenarios.md: "no
// stub/fake integration provider — same posture as no-fake-sandbox/no-mock-
// LLM. Use a real cataloged api_key-kind integration definition; the stored
// key is a placeholder value (connect/CRUD paths never validate it against
// the provider)." Steps: connect via `POST /integrations/authentications`
// (authKind api_key) → account created; org admin toggles
// `PATCH /integrations/admin/organizations/{id}/definitions/{id}/enabled`
// off; assert `effective_enabled` composition (org policy override >
// definition default, AND account enabled), off then on again.
//
// SAME SURVEY CORRECTION as secrets.spec.ts / cloud-workspace.spec.ts, and it
// hits harder here: every route this scenario needs — including the org-
// admin policy endpoint — sits behind `current_product_user`
// (auth/dependencies.py), which unconditionally requires a real GitHub OAuth
// identity + ready provider grant, no single-org-mode carve-out. Unlike
// secrets/workspaces, this isn't even scope-limited to "cloud" surfaces in
// spirit — org-admin definition management (list/create/enable) has no
// intrinsic reason to need the ACTOR's own GitHub link at all (it's an
// org-level policy toggle, not a per-user cloud resource) — but the code
// gates it exactly the same as the user-facing connect endpoint. Verified
// directly: a password-only owner account (owner and admin are the same
// role in single-org mode) gets 403 `github_link_required` on the catalog
// read, the connect call, AND the admin enable/disable toggle, before any of
// this scenario's business logic (account creation, effective_enabled
// composition, negatives) is ever reached.
//
// The connect target is real, not fabricated: `context7` is a genuine
// `api_key`-kind entry in SEED_DEFINITIONS
// (server/proliferate/server/cloud/integrations/seeds.py), upserted into
// `cloud_integration_definition` on every server boot by
// `sync_seed_definitions` (server/proliferate/main.py). This spec resolves
// its id with one direct-DB read (same class of seed-via-product-data as
// secrets.spec.ts/cloud-workspace.spec.ts's own direct reads) specifically to
// prove the 403 fires even against a definition that indisputably exists —
// not a 404 masquerading as the gate.
//
// Per this wave's explicit instruction not to fake GitHub auth, this spec
// pins the AS-BUILT gate instead of the deeper connect/toggle assertions,
// which stay unverified pending either a product decision (should org-admin
// policy management at least be exempted, the way `current_organization_actor`
// already exempts single-org org/invitation endpoints?) or a real GitHub App
// test fixture.
//
// UPDATE: PR #1023 ("extend single-org bypass to current_product_user"),
// merged to main 2026-07-09, answers the question above directly — it adds
// the exact same single-org bypass to `current_product_user` itself, which
// this file's admin-router calls also depend on. Once this branch's stack
// (tests/intent-wave2) rebases past it, every GAP test in this file should
// flip to real connect/toggle assertions rather than 403s. Not rebasing this
// PR onto that fix myself — that is the wave's merge-train's job, not a
// single stacked PR's.

import { expect, test } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  ensureInstanceClaimed,
  getOwnOrganization,
  passwordLogin,
} from "../stack/seed.ts";
import {
  authenticateApiKeyIntegration,
  getIntegrationCatalog,
  getSeedIntegrationDefinitionId,
  listAdminIntegrationDefinitions,
  setAdminIntegrationEnabled,
} from "../stack/seed-integrations.ts";

test.describe.configure({ mode: "serial" });

let ownerToken: string;
let organizationId: string;
let context7DefinitionId: string;

test.beforeAll(async () => {
  await ensureInstanceClaimed();
  ownerToken = (await passwordLogin(ADMIN_EMAIL, ADMIN_PASSWORD)).access_token;
  organizationId = (await getOwnOrganization(ownerToken)).id;
  // Direct-DB, not the API: proves the definition genuinely exists
  // (source='seed', a real cataloged connector) independent of the gate this
  // spec is about to demonstrate blocks reading it back through the API.
  context7DefinitionId = await getSeedIntegrationDefinitionId("context7");
});

function expectGitHubLinkRequired(result: { status: number; body: unknown }): void {
  expect(result.status).toBe(403);
  const detail = (result.body as { detail?: { code?: string } }).detail;
  expect(detail?.code).toBe("github_link_required");
}

test.describe("T2-INT-1: api_key connect + org policy toggle — blocked at the product-readiness gate before reaching integrations logic", () => {
  test("documents GAP: the integration catalog is unreachable for a password-only account, even though context7 (a real api_key definition) exists in it", async () => {
    expectGitHubLinkRequired(await getIntegrationCatalog(ownerToken));
  });

  test("documents GAP: connecting an api_key integration 403s before the connect logic runs, against a real seeded definition id", async () => {
    expectGitHubLinkRequired(
      await authenticateApiKeyIntegration(ownerToken, context7DefinitionId, "placeholder-api-key-value"),
    );
  });

  test("documents GAP: the org-admin policy surface (list + enable/disable toggle) hits the same account-level gate — it is not org-role-scoped, so the owner/admin cannot manage a real definition's policy either", async () => {
    expectGitHubLinkRequired(await listAdminIntegrationDefinitions(ownerToken, organizationId));
    expectGitHubLinkRequired(
      await setAdminIntegrationEnabled(ownerToken, organizationId, context7DefinitionId, false),
    );
  });
});

// NOT COVERED by this wave, named so the gap is loud rather than silent:
// - IntegrationAccountResponse shape on a successful connect (accountId,
//   status, enabled=true) for an api_key definition;
// - effective_enabled composition across all three layers (org policy
//   override > definition default, AND account enabled) — the toggle
//   off-then-on round trip the scenario names;
// - the OAuth-kind seam-only assertion (flow row created, authorizationUrl
//   returned, no real provider round-trip) — also unreachable via this gate,
//   same as the api_key path;
// - IntegrationHealthResponse reflecting the toggled state.
// All of the above require getting a test account past current_product_user's
// GitHub-readiness gate, which this wave does not fake. Re-scope once Pablo
// rules on the GAP above (see also secrets.spec.ts / cloud-workspace.spec.ts,
// which hit the identical gate on the cloud secrets/workspaces surfaces).
