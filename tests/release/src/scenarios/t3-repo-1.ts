import assert from "node:assert/strict";

import type { ScenarioDefinition } from "./types.js";
import { ScenarioBlockedError, ScenarioExpectedFailError } from "./types.js";
import { ApiClient } from "../fixtures/http.js";
import { loginDurableUser } from "../fixtures/identity.js";
import { DEFAULT_GITHUB_TEST_REPO } from "../config/env-manifest.js";
import {
  githubAppSeedAvailable,
  isGithubAppAuthorizationRequiredError,
  isGithubAppInstallationRequiredError,
  isGithubAppRepoNotCoveredError,
  isGithubAppRefreshFailedError,
  isGithubRepoAccessRequiredError,
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
 * #1043: the write path (`PUT .../environment`) needs the durable identity's
 * real GitHub App user authorization + a real installation covering the fixture
 * repo. github_app_seed.py plants a real user-to-server authorization WITHOUT a
 * browser by refreshing a bootstrap token — but the bootstrap token has to be
 * obtained once, interactively, by the GitHub identity the durable user maps to
 * (proliferate-e2e-bot) authorizing the target profile's App. That one step is
 * not something the runner can perform (no GitHub browser creds; a consequential
 * external-identity action), so wherever the authority chain is unsatisfied the
 * scenario reports `blocked` on #1043 — an out-of-band, externally-tracked
 * blocker — rather than expected-fail (a diagnosed permanent gap) or red.
 *
 *  - `--lane staging`: the staging durable user (proliferate-e2e-bot) has never
 *    completed the App user authorization for the staging App
 *    (proliferate-cloud-staging, id 4260213). The seam to seed it is
 *    github_app_seed.py run IN-VPC against the staging DB, bootstrapped once by
 *    that interactive authorization. Handoff:
 *    tests/release/scripts/github_app_user_authorization_bootstrap.py.
 *  - `--lane local`: the t3local profile's configured App (proliferate-dev, id
 *    2486507) is installed only on `pablonyx`, not the fixture org
 *    `proliferate-e2e`, and/or the seeded user lacks repo access — the same
 *    provisioning gap, tracked under #1043.
 *
 * When the bootstrap + install are provisioned this scenario runs green with no
 * code change.
 */
export const t3Repo1: ScenarioDefinition = {
  id: "T3-REPO-1",
  title: "repo settings take effect, both lanes",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-REPO-1",
  lanes: ["local", "sandbox"],
  requiredEnv: [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
    "RELEASE_E2E_LOCAL_DATABASE_URL",
  ],
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
    throw new ScenarioBlockedError(
      "T3-REPO-1: blocked on #1043 — GitHub App seed credentials are unavailable (RELEASE_E2E_LOCAL_DATABASE_URL + " +
        "a bootstrap seed refresh token / state file), so the durable user's App authorization cannot be planted " +
        "and the repo-environment PUT would 409 github_app_authorization_required. The bootstrap token needs a " +
        "one-time interactive App authorization by the durable user's GitHub identity " +
        "(tests/release/scripts/github_app_user_authorization_bootstrap.py) — an out-of-band step, not a scenario gap.",
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
      throw new ScenarioBlockedError(
        `T3-REPO-1: blocked on #1043 — authorization passes (seed works), but the repo-environment PUT 409s on the ` +
          `installation gate for ${owner}/${repo}. The configured GitHub App is not installed on the fixture org ` +
          `${owner} with coverage of the repo (on t3local the App is proliferate-dev, id 2486507, installed only on ` +
          `pablonyx). Provisioning the App install on the fixture org is an out-of-band step — provision it (or point ` +
          `RELEASE_E2E_GITHUB_TEST_REPO at a repo the configured installation covers) to run this green.`,
      );
    }
    if (isGithubAppRefreshFailedError(error)) {
      throw new ScenarioExpectedFailError(
        "T3-REPO-1: the server could not refresh the seeded GitHub App authorization (502 " +
          "github_app_refresh_failed). Seed refresh tokens rotate on every use, so running T3-PROV-1 and " +
          "T3-REPO-1 in the same suite pass can leave this refresh with a stale token. Environmental/seed-" +
          "state fragility, not a product bug — re-seed the bootstrap refresh token (github_app_seed.py) or " +
          "run T3-REPO-1 in isolation to exercise it for real.",
      );
    }
    if (isGithubRepoAccessRequiredError(error)) {
      throw new ScenarioBlockedError(
        `T3-REPO-1: blocked on #1043 — authorization AND installation pass, but the authority chain 409s ` +
          `github_repo_access_required: the seeded GitHub user (the App user-to-server identity github_app_seed.py ` +
          `plants) is not a collaborator with access to ${owner}/${repo}. Grant the seeded identity access to the ` +
          `fixture repo (or bootstrap an identity that already has it), then this runs green with no code change.`,
      );
    }
    throw error;
  }
  assert.equal(response.defaultBranch, "develop", "T3-REPO-1: repo environment default branch must round-trip");
  throw new ScenarioExpectedFailError(
    "T3-REPO-1: repo-environment PUT verified against the live server (authorization + installation + repo " +
      "access all satisfied; default branch round-tripped). The rest (fresh workspace creation + " +
      "checkout/setup-script/env-var assertions in both lanes, and teardown reset) is not yet implemented — " +
      "tracked test TODO (#1041/#1042).",
  );
}
