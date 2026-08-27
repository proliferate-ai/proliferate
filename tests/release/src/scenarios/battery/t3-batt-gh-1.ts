import assert from "node:assert/strict";

import type { ScenarioDefinition } from "../types.js";
import { BATTERY_FLOW_REF, assertStagingLane, authenticateBattery } from "./common.js";

interface UserAuthorizationStatus {
  connected: boolean;
  githubLogin?: string | null;
  status?: string | null;
  action?: string | null;
}

interface AccessibleRepos {
  repositories: Array<{ fullName: string; gitOwner: string; gitRepoName: string }>;
  nextCursor: string | null;
}

/**
 * T3-BATT-GH-1 — the GitHub App user grant works, live on staging.
 *
 * Journey: the durable user's GitHub App user authorization is connected
 * (`GET /v1/cloud/github-app/user-authorization`), and the accessible-repos
 * surface answers with repositories through that grant. When
 * RELEASE_E2E_GITHUB_TEST_REPO is set, the fixture repo must be among them.
 *
 * Outcomes asserted: `connected=true` with a github login · accessible-repos
 * returns a list · the fixture repo is listed when named.
 */
export const t3BattGh1: ScenarioDefinition = {
  id: "T3-BATT-GH-1",
  title: "battery: GitHub App user grant → accessible repos",
  registryFlowRef: BATTERY_FLOW_REF,
  lanes: ["sandbox"],
  requiredEnv: ["RELEASE_E2E_SERVER_URL"],
  plan: () => [
    { description: "authenticate the durable user" },
    { description: "GET /v1/cloud/github-app/user-authorization; assert connected with a github login" },
    { description: "GET /v1/cloud/github-app/accessible-repos; assert a repository list (fixture repo present when named)" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    assertStagingLane("T3-BATT-GH-1", ctx);
    const { client } = await authenticateBattery("T3-BATT-GH-1", ctx);

    const authorization = await client.get<UserAuthorizationStatus>("/v1/cloud/github-app/user-authorization");
    assert.equal(
      authorization.connected,
      true,
      `T3-BATT-GH-1: the durable user's GitHub App user authorization must be connected ` +
        `(status=${authorization.status ?? "?"}, action=${authorization.action ?? "none"})`,
    );
    assert.ok(authorization.githubLogin, "T3-BATT-GH-1: a connected authorization must name the github login");

    const repos = await client.get<AccessibleRepos>("/v1/cloud/github-app/accessible-repos");
    assert.ok(Array.isArray(repos.repositories), "T3-BATT-GH-1: accessible-repos must return a repository list");

    const fixtureRepo = process.env.RELEASE_E2E_GITHUB_TEST_REPO?.trim();
    if (fixtureRepo) {
      assert.ok(
        repos.repositories.some((repo) => repo.fullName === fixtureRepo),
        `T3-BATT-GH-1: the fixture repo ${fixtureRepo} must be accessible through the grant ` +
          `(got ${repos.repositories.length} repos: ${repos.repositories.slice(0, 5).map((repo) => repo.fullName).join(", ")}…)`,
      );
    }

    console.log(
      `[T3-BATT-GH-1/staging] green: github login ${authorization.githubLogin} connected; ` +
        `${repos.repositories.length} accessible repos${fixtureRepo ? ` incl. ${fixtureRepo}` : ""}.`,
    );
  },
};
