import type { ScenarioDefinition } from "./types.js";
import { runStub } from "./stub-runner.js";

/**
 * T3-PROV-2 — access: existing user (warm path).
 * specs/developing/testing/scenarios.md#T3-PROV-2
 */
export const t3Prov2: ScenarioDefinition = {
  id: "T3-PROV-2",
  title: "access — existing user (warm path)",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-PROV-2",
  lanes: ["sandbox"],
  requiredEnv: [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
    "RELEASE_E2E_E2B_API_KEY",
    "RELEASE_E2E_E2B_TEAM_ID",
  ],
  plan: () => [
    { description: "log in as the durable user via T3-FIXTURE" },
    { description: "reopen the durable user's existing cloud workspace" },
    { description: "pause the workspace, assert status becomes paused and inaccessible" },
    { description: "resume the workspace, assert status becomes running within budget" },
    { description: "connect again and assert prior workspace state is intact" },
  ],
  run: (ctx) => runStub(t3Prov2, ctx),
};
