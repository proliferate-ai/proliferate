import assert from "node:assert/strict";

import type { ScenarioDefinition } from "./types.js";
import { ScenarioExpectedFailError } from "./types.js";
import { withProductGate } from "../fixtures/product-gate.js";
import { ApiClient, ApiRequestError } from "../fixtures/http.js";
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
 *
 * Real-run finding (2026-07-09, filed as
 * https://github.com/proliferate-ai/proliferate/issues/1043): once the
 * request itself is valid (see issue #1040 — this scenario's own
 * `runCommand: null` bug, now fixed), the PUT still 409s in both lanes with
 * `github_app_authorization_required`. That gate is deeper than
 * `current_product_user`/`github_link_required` (already fixed by #1023 —
 * confirmed live, since the request now gets past it): configuring a
 * GitHub-hosted cloud repo's environment requires a real GitHub App
 * installation authorization, which this runner's password-only durable
 * e2e-tests identity has no way to obtain — the same structural limitation
 * T3-PROV-1 hit with the real OAuth callback. Marked expected-fail rather
 * than retried.
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

  let response: { defaultBranch: string; setupScript: string };
  try {
    response = await client.put<{ defaultBranch: string; setupScript: string }>(
      `/v1/cloud/repositories/${owner}/${repo}/environment`,
      {
        kind: "cloud",
        gitProvider: "github",
        defaultBranch: "develop",
        setupScript: "echo t3-repo-1-setup-ran > /tmp/t3-repo-1-marker",
        // "" (not null) is how the product UI expresses "no run command" — see
        // apps/desktop/src/lib/domain/settings/environment-draft.ts and
        // use-cloud-environment-draft.ts. runCommand is a non-optional string on
        // the server (SaveRepoEnvironmentRequest), so null 422s.
        runCommand: "",
      },
    );
  } catch (error) {
    if (isGithubAppAuthorizationRequiredError(error)) {
      throw new ScenarioExpectedFailError(
        "T3-REPO-1: repo-environment PUT 409s with github_app_authorization_required — the durable " +
          "e2e-tests identity is password-only and has no way to obtain a real GitHub App " +
          "installation authorization. Filed as https://github.com/proliferate-ai/proliferate/issues/1043.",
      );
    }
    throw error;
  }
  assert.equal(response.defaultBranch, "develop", "T3-REPO-1: repo environment default branch must round-trip");
  throw new Error(
    "T3-REPO-1: repo-environment PUT succeeded (gate lifted) but the rest of this scenario " +
      "(fresh workspace creation + checkout/setup-script/env-var assertions in both lanes, and " +
      "teardown reset) is not yet implemented — finish it now that the gate is open.",
  );
}

// FastAPI's default HTTPException envelope wraps the raised detail:
// `{"detail": {"code": "github_app_authorization_required", "message": "..."}}`
// (see server/proliferate/server/cloud/github_app/repo_authority.py), mirroring
// isGithubLinkRequiredError in fixtures/identity.ts.
function isGithubAppAuthorizationRequiredError(error: unknown): boolean {
  if (!(error instanceof ApiRequestError) || error.status !== 409 || typeof error.body !== "object" || error.body === null) {
    return false;
  }
  const body = error.body as { code?: unknown; detail?: { code?: unknown } };
  return body.code === "github_app_authorization_required" || body.detail?.code === "github_app_authorization_required";
}
