import assert from "node:assert/strict";

import type { ScenarioDefinition } from "./types.js";
import { ScenarioExpectedFailError } from "./types.js";
import { ApiClient } from "../fixtures/http.js";
import { loginDurableUser } from "../fixtures/identity.js";
import { DEFAULT_GITHUB_TEST_REPO } from "../config/env-manifest.js";
import {
  githubAppSeedAvailable,
  isGithubAppAuthorizationRequiredError,
  isGithubAppInstallationRequiredError,
  isGithubAppRepoNotCoveredError,
  runGithubAppSeed,
  type SeedResult,
} from "../fixtures/github-app-seed.js";

/**
 * T3-REPO-1 — repo settings take effect, both lanes.
 * specs/developing/testing/scenarios.md#T3-REPO-1
 *
 * `PUT /repositories/{owner}/{repo}/environment` (default branch + setup
 * script) is `current_product_user`-gated for BOTH lanes, and behind that, the
 * GitHub App authority chain (`require_github_cloud_repo_authority`) gates it
 * on a real App user authorization + a real installation covering the repo.
 *
 * #1043 update (2026-07-09): the originally-pinned blocker was that the
 * password-only durable identity "has no seedable path to a GitHub App
 * installation." That is now resolved: github_app_seed.py plants a real
 * user-to-server authorization for the durable user (a real App token,
 * refreshed — no browser), so `ensure_fresh_github_app_authorization` passes
 * and the PUT gets past `github_app_authorization_required`. The expected-fail
 * pin for that code is therefore lifted.
 *
 * Remaining t3local blocker (environmental, NOT the product, NOT #1043's stated
 * cause): the profile's configured GitHub App is `proliferate-dev` (id
 * 2486507), installed only on `pablonyx` — it is NOT installed on the fixture
 * org `proliferate-e2e`, so once authorization passes the authority chain now
 * 409s `github_app_installation_required` for proliferate-e2e/e2e-fixture. The
 * fixture doc's `proliferate-cloud-pablo` app + installation 145311006 is
 * configured nowhere on t3local. This is reported to Pablo (App-credential
 * availability) and is a fixture/infra provisioning gap, not a code bug — so it
 * is an expected-fail with an accurate environmental diagnosis, and NO product
 * issue is filed. When the fixture app is provisioned on the runner profile (or
 * the target repo is one the configured installation covers) this scenario runs
 * green with no code change.
 */
export const t3Repo1: ScenarioDefinition = {
  id: "T3-REPO-1",
  title: "repo settings take effect, both lanes",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-REPO-1",
  lanes: ["local", "sandbox"],
  requiredEnv: ["RELEASE_E2E_SERVER_URL", "RELEASE_E2E_DURABLE_USER_EMAIL", "RELEASE_E2E_DURABLE_USER_PASSWORD"],
  plan: ({ runtimeLane }) => [
    { description: "seed the durable user's real GitHub App authorization (github_app_seed.py seed; no browser)" },
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
    await runReal(ctx.env.require("RELEASE_E2E_SERVER_URL"));
  },
};

async function runReal(serverUrl: string): Promise<void> {
  const durableEmail = process.env.RELEASE_E2E_DURABLE_USER_EMAIL as string;
  const durablePassword = process.env.RELEASE_E2E_DURABLE_USER_PASSWORD as string;
  const [owner, repo] = (process.env.RELEASE_E2E_GITHUB_TEST_REPO ?? DEFAULT_GITHUB_TEST_REPO).split("/");

  // Seed the durable user's real App authorization (deliverable A). Without it,
  // the PUT 409s github_app_authorization_required (the original #1043 pin).
  if (githubAppSeedAvailable(process.env)) {
    const seed = await runGithubAppSeed<SeedResult>(durableEmail, { command: "seed" });
    assert.equal(seed.seeded?.status, "ready", "T3-REPO-1: durable user's GitHub App authorization must be seeded ready");
  } else {
    throw new ScenarioExpectedFailError(
      "T3-REPO-1: GitHub App seed credentials are unavailable (RELEASE_E2E_LOCAL_DATABASE_URL + a seed refresh " +
        "token / state file) — cannot plant the durable user's App authorization, so the repo-environment PUT " +
        "would 409 github_app_authorization_required (#1043). Provision the seed to run this for real.",
    );
  }

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
        // apps/desktop/src/lib/domain/settings/environment-draft.ts. runCommand
        // is a non-optional string on the server (SaveRepoEnvironmentRequest).
        runCommand: "",
      },
    );
  } catch (error) {
    if (isGithubAppAuthorizationRequiredError(error)) {
      // Should no longer happen now that we seed — surface loudly if it does.
      throw new Error(
        "T3-REPO-1: repo-environment PUT still 409s github_app_authorization_required AFTER seeding a real App " +
          "authorization — the seed did not take. Investigate github_app_seed.py / the durable user's row.",
      );
    }
    if (isGithubAppInstallationRequiredError(error) || isGithubAppRepoNotCoveredError(error)) {
      throw new ScenarioExpectedFailError(
        `T3-REPO-1: authorization now passes (seed works), but the repo-environment PUT 409s on the installation ` +
          `gate for ${owner}/${repo}. t3local's configured GitHub App (proliferate-dev, id 2486507) is installed ` +
          `only on pablonyx, NOT on the fixture org ${owner}; the fixture doc's proliferate-cloud-pablo app + ` +
          `installation 145311006 is configured nowhere on this profile. Environmental/fixture gap, not a product ` +
          `bug — provision the fixture app on the runner profile (or point RELEASE_E2E_GITHUB_TEST_REPO at a repo ` +
          `the configured installation covers) to run this green. See #1043.`,
      );
    }
    throw error;
  }
  assert.equal(response.defaultBranch, "develop", "T3-REPO-1: repo environment default branch must round-trip");
  throw new Error(
    "T3-REPO-1: repo-environment PUT succeeded (authorization + installation both satisfied) but the rest of this " +
      "scenario (fresh workspace creation + checkout/setup-script/env-var assertions in both lanes, and teardown " +
      "reset) is not yet implemented — finish it now that the gate is fully open.",
  );
}
