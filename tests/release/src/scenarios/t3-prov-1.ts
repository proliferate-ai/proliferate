import type { ScenarioDefinition } from "./types.js";
import { runStub } from "./stub-runner.js";

/**
 * T3-PROV-1 — provision: new user (cold path).
 * specs/developing/testing/scenarios.md#T3-PROV-1
 */
export const t3Prov1: ScenarioDefinition = {
  id: "T3-PROV-1",
  title: "provision — new user (cold path)",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-PROV-1",
  lanes: ["sandbox"],
  requiredEnv: [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
    "RELEASE_E2E_DURABLE_ORG_ID",
    "RELEASE_E2E_E2B_API_KEY",
    "RELEASE_E2E_E2B_TEAM_ID",
  ],
  plan: () => [
    { description: "mint a fresh user via T3-FIXTURE (invite + password register + login)" },
    { description: "as the fresh user, create the first-ever cloud workspace" },
    { description: "observe personal sandbox enrollment, worker boot, materialization from zero" },
    {
      description:
        "assert workspace reaches ready within budget (p95 <= 5min fail, warn at 3min — budget number pending Pablo's ruling)",
    },
    { description: "connect to the workspace and run one shell command" },
    { description: "assert the command executes and returns output" },
    { description: "teardown: remove the fresh user's org membership" },
  ],
  run: (ctx) => runStub(t3Prov1, ctx),
};
