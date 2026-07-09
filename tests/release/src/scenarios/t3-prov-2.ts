import assert from "node:assert/strict";

import type { ScenarioDefinition } from "./types.js";
import type { TargetLane } from "../config/types.js";
import { ScenarioBlockedError, ScenarioExpectedFailError } from "./types.js";
import { withProductGate } from "../fixtures/product-gate.js";
import { ApiClient } from "../fixtures/http.js";
import { loginDurableUserForTargetLane, StagingSessionUnavailableError } from "../fixtures/staging-session.js";

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
    await withProductGate("T3-PROV-2", () => runReal(ctx.env.require("RELEASE_E2E_SERVER_URL"), ctx.targetLane));
  },
};

async function runReal(serverUrl: string, targetLane: TargetLane): Promise<void> {
  let session;
  try {
    session = await loginDurableUserForTargetLane({ targetLane, serverUrl });
  } catch (error) {
    // A broken staging session chain reports blocked, never red — the fix is
    // re-bootstrapping the token out of band, not a product/scenario bug.
    if (error instanceof StagingSessionUnavailableError) {
      throw new ScenarioBlockedError(error.message);
    }
    throw error;
  }
  const client = new ApiClient({ baseUrl: serverUrl }).withBearerToken(session.accessToken);

  // Read-only reconnect probe (both lanes): does the durable user already have
  // a personal cloud sandbox (the warm fixture)?
  const existing = await client.get<{ status: string } | null>("/v1/cloud/cloud-sandbox");

  if (targetLane === "staging") {
    // First real end-to-end proof on the staging deployment: the durable user
    // authenticated through the rotating product session and its cloud-sandbox
    // state read back over the real API. The mutating half (POST wake, which
    // spins a real E2B sandbox and costs money against the SHARED durable
    // user's warm sandbox) is deliberately deferred out of this first staging
    // pass — driving/pausing/waking the shared durable sandbox on staging is
    // gated on a dedicated non-shared fixture, so it stays expected-fail here
    // rather than mutating shared state. See tests/release/README.md
    // (staging-lane runbook).
    throw new ScenarioExpectedFailError(
      "T3-PROV-2/staging: durable-user auth (rotating staging session) + GET /cloud-sandbox verified " +
        `against the live staging deployment (existing sandbox: ${existing ? existing.status : "none"}). ` +
        "The mutating pause/wake/reconnect half is deferred from the first staging pass to avoid spinning " +
        "and mutating the SHARED durable user's E2B sandbox — needs a dedicated non-shared staging fixture. " +
        "Tracked test TODO (#1041).",
    );
  }

  assert.ok(existing, "T3-PROV-2: durable user must already have a personal cloud sandbox (the warm fixture)");
  const woken = await client.post<{ status: string }>("/v1/cloud/cloud-sandbox/wake", {});
  assert.equal(woken.status, "ready", "T3-PROV-2: waking the durable sandbox must return status=ready");
  throw new ScenarioExpectedFailError(
    "T3-PROV-2: GET /cloud-sandbox + POST /cloud-sandbox/wake verified against the live server on fresh " +
      "main (single-org current_product_user bypass; wake returned status=ready). The remaining pause + " +
      "reconnect-state-intact assertions are not yet implemented — tracked test TODO (#1041).",
  );
}
