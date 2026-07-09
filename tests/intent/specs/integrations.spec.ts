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
  getIntegrationHealth,
  getSeedIntegrationDefinitionId,
  listAdminIntegrationDefinitions,
  readUntil,
  removeIntegrationAccount,
  setAdminIntegrationEnabled,
  type AdminIntegrationDefinitionResult,
  type IntegrationHealthItemResult,
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

/** Read the admin definition list until context7's row satisfies `settled`
 * (bounded; returns the last-read row either way — see readUntil). */
async function readAdminDefinitionUntil(
  settled: (item: AdminIntegrationDefinitionResult | undefined) => boolean,
): Promise<AdminIntegrationDefinitionResult | undefined> {
  const body = await readUntil(
    async () => {
      const result = await listAdminIntegrationDefinitions(ownerToken, organizationId);
      expect(result.status).toBe(200);
      return result.body;
    },
    (items) => settled(items.find((item) => item.definitionId === context7DefinitionId)),
  );
  return body.find((item) => item.definitionId === context7DefinitionId);
}

/** Same, for context7's row on the health surface. */
async function readHealthUntil(
  settled: (item: IntegrationHealthItemResult | undefined) => boolean,
): Promise<IntegrationHealthItemResult | undefined> {
  const body = await readUntil(
    async () => {
      const result = await getIntegrationHealth(ownerToken, organizationId);
      expect(result.status).toBe(200);
      return result.body;
    },
    (response) => settled(response.items.find((item) => item.definitionId === context7DefinitionId)),
  );
  return body.items.find((item) => item.definitionId === context7DefinitionId);
}

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
    // Normalize the starting state instead of assuming it: with no policy
    // row yet, effective_enabled falls back to the definition's own
    // enabled_by_default (true for every seed definition), but this profile
    // DB persists across runs and a prior run that failed mid-file can leave
    // the policy row off — so if it is off, turn it back on first. What the
    // test then asserts is the transition, which is the actual contract.
    const before = await listAdminIntegrationDefinitions(ownerToken, organizationId);
    expect(before.status).toBe(200);
    const context7Before = before.body.find((item) => item.definitionId === context7DefinitionId);
    if (context7Before?.policyEnabled === false) {
      const heal = await setAdminIntegrationEnabled(ownerToken, organizationId, context7DefinitionId, true);
      expect(heal.status).toBe(200);
      await readAdminDefinitionUntil((item) => item?.policyEnabled === true);
    }
    const settledBefore = await readAdminDefinitionUntil((item) => item?.effectiveEnabled === true);
    expect(settledBefore?.effectiveEnabled).toBe(true);

    const off = await setAdminIntegrationEnabled(ownerToken, organizationId, context7DefinitionId, false);
    expect(off.status).toBe(200);
    expect(off.body.policyEnabled).toBe(false);
    expect(off.body.effectiveEnabled).toBe(false);

    // Persisted, not just echoed back on the toggle call itself. readUntil
    // absorbs the endpoint's commit-in-dependency-teardown lag (see
    // seed-integrations.ts); the assertions still run on the settled value.
    const context7After = await readAdminDefinitionUntil(
      (item) => item?.policyEnabled === false,
    );
    expect(context7After?.policyEnabled).toBe(false);
    expect(context7After?.effectiveEnabled).toBe(false);
  });

  test("org admin toggles the definition back on: effective_enabled true again", async () => {
    const on = await setAdminIntegrationEnabled(ownerToken, organizationId, context7DefinitionId, true);
    expect(on.status).toBe(200);
    expect(on.body.policyEnabled).toBe(true);
    expect(on.body.effectiveEnabled).toBe(true);

    const context7After = await readAdminDefinitionUntil(
      (item) => item?.policyEnabled === true,
    );
    expect(context7After?.policyEnabled).toBe(true);
    expect(context7After?.effectiveEnabled).toBe(true);
  });

  // The health surface (GET /integrations/health) is the response the UI
  // actually renders, and the only one that carries all three enablement
  // layers side by side: policyEnabled (org override), effectiveEnabled
  // (override > definition default), accountEnabled, plus the composed
  // verdict. For an api_key account the health probe is DB-only —
  // _account_health (health.py) runs its ensure_provider_access probe only
  // for auth_kind == "oauth2" — so this read is itself outbound-free, same
  // as the connect path.
  test("health surface composes all three layers for the connected account: ready, effective-enabled, account enabled", async () => {
    const item = await readHealthUntil((entry) => entry?.health === "ready");
    expect(item).toBeDefined();
    expect(item?.effectiveEnabled).toBe(true);
    expect(item?.policyEnabled).toBe(true);
    expect(item?.accountEnabled).toBe(true);
    expect(item?.accountId).not.toBeNull();
    expect(item?.health).toBe("ready");
  });

  test("health surface flips to disabled_by_org while the policy is off, with the account row intact underneath", async () => {
    const off = await setAdminIntegrationEnabled(ownerToken, organizationId, context7DefinitionId, false);
    expect(off.status).toBe(200);

    const item = await readHealthUntil((entry) => entry?.health === "disabled_by_org");
    expect(item?.effectiveEnabled).toBe(false);
    expect(item?.policyEnabled).toBe(false);
    expect(item?.health).toBe("disabled_by_org");
    // The org toggle disables exposure, it does not touch the user's account:
    // the connected account row survives, still enabled at its own layer.
    expect(item?.accountId).not.toBeNull();
    expect(item?.accountEnabled).toBe(true);

    // Restore for the tests below (and for reruns on this persisted profile DB).
    const on = await setAdminIntegrationEnabled(ownerToken, organizationId, context7DefinitionId, true);
    expect(on.status).toBe(200);

    const restoredItem = await readHealthUntil((entry) => entry?.health === "ready");
    expect(restoredItem?.effectiveEnabled).toBe(true);
    expect(restoredItem?.health).toBe("ready");
  });

  test("disconnect: DELETE the account 204s, health returns to needs_auth, and re-connecting works", async () => {
    const connected = await readHealthUntil((entry) => entry?.accountId != null);
    expect(connected?.accountId).not.toBeNull();

    const removed = await removeIntegrationAccount(ownerToken, connected!.accountId!);
    expect(removed.status).toBe(204);

    const disconnected = await readHealthUntil((entry) => entry?.accountId == null);
    expect(disconnected?.accountId).toBeNull();
    expect(disconnected?.accountEnabled).toBeNull();
    expect(disconnected?.health).toBe("needs_auth");
    // Org policy is unaffected by the account's removal.
    expect(disconnected?.effectiveEnabled).toBe(true);

    // Re-connect (still a placeholder key, still no outbound) so the suite
    // ends in the connected steady state every earlier test assumes on rerun.
    const reconnect = await authenticateApiKeyIntegration(
      ownerToken,
      context7DefinitionId,
      "placeholder-api-key-value-reconnect",
    );
    expect(reconnect.status).toBe(200);
    expect(reconnect.body.account.status).toBe("ready");

    const reconnected = await readHealthUntil((entry) => entry?.accountId != null);
    expect(reconnected?.health).toBe("ready");
    expect(reconnected?.accountId).not.toBeNull();
  });
});

// NOT COVERED, named so the gap is loud rather than silent:
// - The OAuth-kind connect seam (scenarios.md's negative: "flow row created,
//   authorizationUrl returned, no real provider round-trip"). Deliberately
//   excluded, not just unpicked: as built, start_oauth_flow
//   (server/proliferate/server/cloud/integrations/oauth/service.py) performs
//   real provider metadata discovery against the definition's MCP URL
//   (discover_protected_resource_metadata / discover_authorization_server_
//   metadata) BEFORE any flow row exists or an authorizationUrl can be
//   returned — there is no as-built way to reach that seam without an
//   outbound network call, which tier 2's no-outbound contract forbids.
//   The oauth2 branch is tier 3's to assert (T3-INT-1 posture) unless the
//   discovery step grows a seam.
//
// No-outbound proof for the api_key path, stated once for the whole file:
// authenticate_integration's api_key branch (integrations/service.py) is
// upsert_account + set_account_credentials (local encrypt) only — no code
// path touches the provider, which is why a placeholder key lands
// status="ready" immediately with no oauthFlowId/authorizationUrl (asserted
// above). The health reads used here are also outbound-free for api_key
// accounts: _account_health's provider probe runs only for oauth2 accounts.
