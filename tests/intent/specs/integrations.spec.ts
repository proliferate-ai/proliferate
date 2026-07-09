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
// UPDATE 2026-07-09: PR #1023 ("extend single-org bypass to
// current_product_user"), merged to main, extends the exact same single-org
// bypass `current_organization_actor` already had to `current_product_user`
// itself — which every route in this file (auth/dependencies.py) depends on.
// The 403 `github_link_required` this file used to pin (a password-only
// owner account couldn't even read the integration catalog) no longer fires
// in single-org mode, so this spec now exercises the real T2-INT-1 flow
// instead of documenting the gate.
//
// The connect target is real, not fabricated: `context7` is a genuine
// `api_key`-kind entry in SEED_DEFINITIONS
// (server/proliferate/server/cloud/integrations/seeds.py), upserted into
// `cloud_integration_definition` on every server boot by
// `sync_seed_definitions` (server/proliferate/main.py). This spec resolves
// its id with one direct-DB read (same class of seed-via-product-data as
// secrets.spec.ts/cloud-workspace.spec.ts's own direct reads) — there is
// still no API to list seed definitions by namespace directly, only the
// full catalog.
//
// authenticate_integration (service.py) never checks org policy before
// creating an account — the policy toggle governs whether the org exposes
// the definition (effective_enabled, surfaced to admins/health), not whether
// an already-connected account can authenticate. That composition —
// definition.enabled_by_default (true for every seed, seeds.py) overridden
// by an org's policy row when one exists (db/store/integrations/policies.py)
// — is exactly what this spec's toggle round trip asserts.

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
  // Direct-DB, not the API: there is still no catalog-by-namespace lookup,
  // only the full list. This proves the definition genuinely exists
  // (source='seed', a real cataloged connector) independent of the catalog
  // read the next test performs.
  context7DefinitionId = await getSeedIntegrationDefinitionId("context7");
});

test.describe("T2-INT-1: api_key connect + org policy toggle", () => {
  test("catalog is reachable and lists the real context7 api_key definition with its connect schema", async () => {
    const result = await getIntegrationCatalog(ownerToken);
    expect(result.status).toBe(200);
    const context7 = result.body.items.find((item) => item.definitionId === context7DefinitionId);
    expect(context7).toBeDefined();
    expect(context7?.namespace).toBe("context7");
    expect(context7?.authKind).toBe("api_key");
  });

  test("connects context7 with a placeholder api_key: account created, ready, enabled — no outbound provider call", async () => {
    const result = await authenticateApiKeyIntegration(
      ownerToken,
      context7DefinitionId,
      "placeholder-api-key-value",
    );
    expect(result.status).toBe(200);
    expect(result.body.account.definitionId).toBe(context7DefinitionId);
    expect(result.body.account.namespace).toBe("context7");
    expect(result.body.account.authKind).toBe("api_key");
    expect(result.body.account.status).toBe("ready");
    expect(result.body.account.enabled).toBe(true);
    // api_key connect never starts an OAuth flow.
    expect(result.body.oauthFlowId).toBeNull();
    expect(result.body.authorizationUrl).toBeNull();
  });

  test("org admin toggles the definition off: effective_enabled composes the policy override over the seed default", async () => {
    // Starting state is true either way: with no policy row yet,
    // effective_enabled falls back to the definition's own
    // enabled_by_default (true for every seed definition); if a prior run on
    // this profile DB already created a policy row, this spec's own
    // toggle-back-on step below always leaves it enabled=true. Either way,
    // policyEnabled is either null or true here — never false — going in.
    const before = await listAdminIntegrationDefinitions(ownerToken, organizationId);
    expect(before.status).toBe(200);
    const context7Before = before.body.find((item) => item.definitionId === context7DefinitionId);
    expect(context7Before?.policyEnabled).not.toBe(false);
    expect(context7Before?.effectiveEnabled).toBe(true);

    const off = await setAdminIntegrationEnabled(ownerToken, organizationId, context7DefinitionId, false);
    expect(off.status).toBe(200);
    expect(off.body.policyEnabled).toBe(false);
    expect(off.body.effectiveEnabled).toBe(false);

    // Persisted, not just echoed back on the toggle call itself.
    const after = await listAdminIntegrationDefinitions(ownerToken, organizationId);
    const context7After = after.body.find((item) => item.definitionId === context7DefinitionId);
    expect(context7After?.policyEnabled).toBe(false);
    expect(context7After?.effectiveEnabled).toBe(false);
  });

  test("org admin toggles the definition back on: effective_enabled true again", async () => {
    const on = await setAdminIntegrationEnabled(ownerToken, organizationId, context7DefinitionId, true);
    expect(on.status).toBe(200);
    expect(on.body.policyEnabled).toBe(true);
    expect(on.body.effectiveEnabled).toBe(true);

    const after = await listAdminIntegrationDefinitions(ownerToken, organizationId);
    const context7After = after.body.find((item) => item.definitionId === context7DefinitionId);
    expect(context7After?.policyEnabled).toBe(true);
    expect(context7After?.effectiveEnabled).toBe(true);
  });
});

// NOT COVERED by this wave, named so the gap is loud rather than silent:
// - The OAuth-kind connect path (flow row created, authorizationUrl
//   returned, no real provider round-trip) — context7 is api_key-kind;
//   asserting the oauth2 branch needs a different seed definition (e.g.
//   `exa` is also api_key, so this suite would need to pick an actual
//   oauth2-kind seed to cover that branch, or an org-custom definition).
// - IntegrationHealthResponse reflecting the toggled state (health.py) —
//   this spec only asserts the admin-definition-list composition, not the
//   health surface a connected account also feeds.
// - Removing an account (`DELETE /integrations/accounts/{id}`) and
//   re-connecting.
