import assert from "node:assert/strict";

import type { ScenarioDefinition } from "./types.js";
import { withProductGate } from "../fixtures/product-gate.js";
import { ApiClient } from "../fixtures/http.js";
import { loginDurableUser } from "../fixtures/identity.js";
import { DEFAULT_GITHUB_TEST_REPO } from "../config/env-manifest.js";

/**
 * T3-REPO-1 — repo settings take effect, both lanes.
 * specs/developing/testing/scenarios.md#T3-REPO-1
 *
 * Not in the phase-1 skeleton. `PUT /repositories/{owner}/{repo}/environment`
 * (default branch + setup script) is `current_product_user`-gated for BOTH
 * lanes (confirmed by reading `server/proliferate/server/cloud/repositories/api.py`
 * — every route depends on it, including the ones a local-lane workspace
 * would need to read the configured default branch/setup script from) — so
 * unlike T3-WT-1/T3-CHAT-1/T3-CFG-1, there is no gate-free local-lane path
 * here: repo *environment configuration* is always server-mediated even
 * though workspace *creation* off an already-known path is not.
 */
export const t3Repo1: ScenarioDefinition = {
  id: "T3-REPO-1",
  title: "repo settings take effect, both lanes",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-REPO-1",
  lanes: ["local", "sandbox"],
  requiredEnv: ["RELEASE_E2E_SERVER_URL", "RELEASE_E2E_DURABLE_USER_EMAIL", "RELEASE_E2E_DURABLE_USER_PASSWORD"],
  plan: ({ runtimeLane }) => [
    {
      description: `configure default branch=develop + setup script on the ${
        runtimeLane === "local" ? "local" : "cloud"
      } repo environment for ${process.env.RELEASE_E2E_GITHUB_TEST_REPO ?? DEFAULT_GITHUB_TEST_REPO}`,
    },
    { description: "create a fresh workspace against that repo environment" },
    { description: "assert checkout is on develop; setup script ran (marker file); env vars present in session shell" },
    { description: "teardown: reset repo environment settings" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    await withProductGate("T3-REPO-1", () => runReal(ctx.env.require("RELEASE_E2E_SERVER_URL")));
  },
};

async function runReal(serverUrl: string): Promise<void> {
  const durableEmail = process.env.RELEASE_E2E_DURABLE_USER_EMAIL as string;
  const durablePassword = process.env.RELEASE_E2E_DURABLE_USER_PASSWORD as string;
  const [owner, repo] = (process.env.RELEASE_E2E_GITHUB_TEST_REPO ?? DEFAULT_GITHUB_TEST_REPO).split("/");

  const session = await loginDurableUser({ serverUrl, email: durableEmail, password: durablePassword, organizationId: "" });
  const client = new ApiClient({ baseUrl: serverUrl }).withBearerToken(session.accessToken);

  const response = await client.put<{ defaultBranch: string; setupScript: string }>(
    `/v1/cloud/repositories/${owner}/${repo}/environment`,
    {
      kind: "cloud",
      gitProvider: "github",
      defaultBranch: "develop",
      setupScript: "echo t3-repo-1-setup-ran > /tmp/t3-repo-1-marker",
      runCommand: null,
    },
  );
  assert.equal(response.defaultBranch, "develop", "T3-REPO-1: repo environment default branch must round-trip");
  throw new Error(
    "T3-REPO-1: repo-environment PUT succeeded (gate lifted) but the rest of this scenario " +
      "(fresh workspace creation + checkout/setup-script/env-var assertions in both lanes, and " +
      "teardown reset) is not yet implemented — finish it now that the gate is open.",
  );
}
