import assert from "node:assert/strict";

import type { ScenarioDefinition } from "./types.js";
import { withProductGate } from "../fixtures/product-gate.js";
import { ApiClient } from "../fixtures/http.js";
import { loginDurableUser } from "../fixtures/identity.js";

/**
 * T3-SEC-MAT-1 — secrets materialize.
 * specs/developing/testing/scenarios.md#T3-SEC-MAT-1
 *
 * Not in the phase-1 skeleton (out of scope then; in this runner's explicit
 * scope). All secret PUT/GET routes and cloud workspace creation are
 * `current_product_user`-gated (`server/proliferate/server/cloud/secrets/api.py`,
 * `server/proliferate/server/cloud/workspaces/api.py`) — real code below,
 * reported `blocked` via `withProductGate` until
 * `fix/product-user-single-org-bypass` merges, since materialization
 * fundamentally needs a real cloud sandbox (no local-lane variant exists in
 * the contract for this scenario).
 */
export const t3SecMat1: ScenarioDefinition = {
  id: "T3-SEC-MAT-1",
  title: "secrets materialize",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-SEC-MAT-1",
  lanes: ["sandbox"],
  requiredEnv: ["RELEASE_E2E_SERVER_URL", "RELEASE_E2E_DURABLE_USER_EMAIL", "RELEASE_E2E_DURABLE_USER_PASSWORD"],
  plan: () => [
    { description: "set a personal env-var secret, an org env-var secret, and a workspace file secret" },
    { description: "create a fresh cloud workspace" },
    { description: "poll materialization.status until ready (budget: <=60s on an already-running sandbox)" },
    {
      description:
        "assert in-sandbox: {PROLIFERATE_HOME}/secrets/global.env has both merged vars; " +
        "{repo}/.proliferate/env/workspace.env present; manifest sha256s match",
    },
    { description: "PUT a new value; assert status returns to pending then ready; assert sandbox file updated" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    await withProductGate("T3-SEC-MAT-1", () => runReal(ctx.env.require("RELEASE_E2E_SERVER_URL")));
  },
};

async function runReal(serverUrl: string): Promise<void> {
  const durableEmail = process.env.RELEASE_E2E_DURABLE_USER_EMAIL as string;
  const durablePassword = process.env.RELEASE_E2E_DURABLE_USER_PASSWORD as string;
  const organizationId = process.env.RELEASE_E2E_DURABLE_ORG_ID ?? "";

  const session = await loginDurableUser({
    serverUrl,
    email: durableEmail,
    password: durablePassword,
    organizationId,
  });
  const client = new ApiClient({ baseUrl: serverUrl }).withBearerToken(session.accessToken);

  const secretName = `T3_SEC_MAT_1_${Date.now()}`;
  const personal = await client.put<{ materialization: { status: string } }>(
    `/v1/cloud/secrets/personal/env-vars/${secretName}`,
    { value: "release-e2e-personal" },
  );
  assert.ok(
    ["pending", "running", "ready"].includes(personal.materialization.status),
    "T3-SEC-MAT-1: PUT personal secret must return a materialization status",
  );
  // Reaching this line for real (not blocked) means the gate has lifted;
  // the fuller flow (org secret, workspace file secret, fresh cloud
  // workspace, in-sandbox file assertions) is intentionally not implemented
  // beyond this first real call — write it once this scenario is actually
  // reachable, verifying each step against the live response shape rather
  // than guessing ahead of the gate.
  throw new Error(
    "T3-SEC-MAT-1: personal secret PUT succeeded (gate lifted) but the rest of this scenario " +
      "(org secret, workspace file secret, fresh cloud workspace + in-sandbox file assertions) " +
      "is not yet implemented — finish it now that the gate is open.",
  );
}
