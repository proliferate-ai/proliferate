// T2-INT-1 (specs/engineering/testing/scenarios.md): real cataloged provider + org policy
// toggle, stopping before any provider boundary.
//
// Scenario, per the 2026-07-08 ruling baked into scenarios.md: "no
// stub/fake integration provider — same posture as no-fake-sandbox/no-mock-
// LLM. Use a real cataloged api_key-kind integration definition. Tier 2
// resolves the real seed, reads the catalog + health projections, and
// toggles `PATCH /integrations/admin/organizations/{id}/definitions/{id}/enabled`.
// API-key authentication now validates staged credentials with MCP tools/list,
// so this suite never submits a placeholder key or fabricates that provider
// boundary. Tier-1 server tests own mocked stage/validate/swap; T3-INT-1 owns
// the real provider proof.
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
// (server/proliferate/server/integration_gateway/connections/seeds.py),
// upserted into `cloud_integration_definition` on every server boot by
// `sync_seed_definitions` (server/proliferate/main.py). This spec resolves
// its id with one direct-DB read — there is
// still no API to list seed definitions by namespace directly, only the
// full catalog.
//
// The composition under test is definition.enabled_by_default (true for every
// seed, seeds.py) overridden by an org policy row
// (db/store/integrations/policies.py). Health exposes that projection even
// without an account, so the proof remains entirely inside the stack.

import { expect, test } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  ensureInstanceClaimed,
  getOwnOrganization,
  passwordLogin,
} from "../stack/seed.ts";
import {
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
  const current = await getIntegrationHealth(ownerToken, organizationId);
  expect(current.status).toBe(200);
  const accountId = current.body.items.find(
    (item) => item.definitionId === context7DefinitionId,
  )?.accountId;
  if (accountId) {
    const removed = await removeIntegrationAccount(ownerToken, accountId);
    expect(removed.status).toBe(204);
    await readHealthUntil((item) => item?.accountId == null);
  }
  const enabled = await setAdminIntegrationEnabled(
    ownerToken,
    organizationId,
    context7DefinitionId,
    true,
  );
  expect(enabled.status).toBe(200);
  await readHealthUntil((item) => item?.effectiveEnabled === true);
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

test.describe("T2-INT-1: cataloged provider + org policy toggle", () => {
  test("catalog is reachable and lists the real context7 api_key definition with its connect schema", async () => {
    const result = await getIntegrationCatalog(ownerToken);
    expect(result.status).toBe(200);
    const context7 = result.body.items.find((item) => item.definitionId === context7DefinitionId);
    expect(context7).toBeDefined();
    expect(context7?.namespace).toBe("context7");
    expect(context7?.authKind).toBe("api_key");
  });

  test("health exposes the real definition without fabricating a connection", async () => {
    const item = await readHealthUntil((entry) => entry?.accountId == null);
    expect(item).toBeDefined();
    expect(item?.effectiveEnabled).toBe(true);
    expect(item?.accountEnabled).toBeNull();
    expect(item?.accountId).toBeNull();
    expect(item?.health).toBe("needs_auth");
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

  test("health surface flips to disabled_by_org while the policy is off, with no account invented", async () => {
    const off = await setAdminIntegrationEnabled(ownerToken, organizationId, context7DefinitionId, false);
    expect(off.status).toBe(200);

    const item = await readHealthUntil((entry) => entry?.health === "disabled_by_org");
    expect(item?.effectiveEnabled).toBe(false);
    expect(item?.policyEnabled).toBe(false);
    expect(item?.health).toBe("disabled_by_org");
    expect(item?.accountId).toBeNull();
    expect(item?.accountEnabled).toBeNull();

    // Restore for the tests below (and for reruns on this persisted profile DB).
    const on = await setAdminIntegrationEnabled(ownerToken, organizationId, context7DefinitionId, true);
    expect(on.status).toBe(200);

    const restoredItem = await readHealthUntil((entry) => entry?.health === "needs_auth");
    expect(restoredItem?.effectiveEnabled).toBe(true);
    expect(restoredItem?.health).toBe("needs_auth");
  });
});
