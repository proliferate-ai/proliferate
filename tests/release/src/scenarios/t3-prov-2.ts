import assert from "node:assert/strict";

import type { ScenarioDefinition } from "./types.js";
import { ScenarioExpectedFailError } from "./types.js";
import { withProductGate } from "../fixtures/product-gate.js";
import { ApiClient } from "../fixtures/http.js";
import { loginDurableUser } from "../fixtures/identity.js";

/**
 * T3-PROV-2 — access: existing user (warm path).
 * specs/developing/testing/scenarios.md#T3-PROV-2
 *
 * Unlike T3-PROV-1 (which has a contract-sanctioned fallback seam because
 * its trigger-under-test, the GitHub App callback, is itself infeasible to
 * drive for real), T3-PROV-2 is specifically about the normal, supported
 * pause/resume/connect path a real existing user takes — `POST
 * /cloud-sandbox/wake`, the pause endpoint, `GET /cloud-sandbox` — all
 * `current_product_user`-gated. There is no sanctioned shortcut here: this
 * scenario's whole point is the front door, so it stays `blocked` (not a
 * fallback) until the gate lifts.
 */
export const t3Prov2: ScenarioDefinition = {
  id: "T3-PROV-2",
  title: "access — existing user (warm path)",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-PROV-2",
  lanes: ["sandbox"],
  requiredEnv: ["RELEASE_E2E_SERVER_URL", "RELEASE_E2E_DURABLE_USER_EMAIL", "RELEASE_E2E_DURABLE_USER_PASSWORD"],
  plan: () => [
    { description: "log in as the durable user via T3-FIXTURE" },
    { description: "GET /cloud-sandbox — reopen the durable user's existing sandbox" },
    { description: "pause the workspace, assert status becomes paused and inaccessible" },
    { description: "POST /cloud-sandbox/wake, assert status becomes running within budget" },
    { description: "connect again and assert prior workspace state is intact" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    await withProductGate("T3-PROV-2", () => runReal(ctx.env.require("RELEASE_E2E_SERVER_URL")));
  },
};

async function runReal(serverUrl: string): Promise<void> {
  const durableEmail = process.env.RELEASE_E2E_DURABLE_USER_EMAIL as string;
  const durablePassword = process.env.RELEASE_E2E_DURABLE_USER_PASSWORD as string;
  const session = await loginDurableUser({ serverUrl, email: durableEmail, password: durablePassword, organizationId: "" });
  const client = new ApiClient({ baseUrl: serverUrl }).withBearerToken(session.accessToken);

  const existing = await client.get<{ status: string } | null>("/v1/cloud/cloud-sandbox");
  assert.ok(existing, "T3-PROV-2: durable user must already have a personal cloud sandbox (the warm fixture)");
  const woken = await client.post<{ status: string }>("/v1/cloud/cloud-sandbox/wake", {});
  assert.equal(woken.status, "ready", "T3-PROV-2: waking the durable sandbox must return status=ready");
  throw new ScenarioExpectedFailError(
    "T3-PROV-2: GET /cloud-sandbox + POST /cloud-sandbox/wake verified against the live server on fresh " +
      "main (single-org current_product_user bypass; wake returned status=ready). The remaining pause + " +
      "reconnect-state-intact assertions are not yet implemented — tracked test TODO (#1041).",
  );
}
