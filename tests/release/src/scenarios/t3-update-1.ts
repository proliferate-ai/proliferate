import type { ScenarioDefinition } from "./types.js";
import { runStub } from "./stub-runner.js";

/**
 * T3-UPDATE-1 — harness convergence, both lanes (pre-verification of tier 4).
 * specs/developing/testing/scenarios.md#T3-UPDATE-1
 */
export const t3Update1: ScenarioDefinition = {
  id: "T3-UPDATE-1",
  title: "harness convergence, both lanes",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-UPDATE-1",
  lanes: ["local", "sandbox"],
  requiredEnv: [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
  ],
  plan: ({ runtimeLane }) => [
    { description: "record current installed harness CLI versions (baseline)" },
    { description: "bump the served catalog version on the target server" },
    {
      description:
        runtimeLane === "local"
          ? "trigger a heartbeat from the local runtime; assert the runtime reconciles and reinstalls the drifted CLI at the new pin"
          : "trigger a heartbeat from the sandbox worker; assert the worker pushes the catalog and the runtime reconciles + reinstalls the drifted CLI at the new pin",
    },
    { description: "assert installed CLI version now matches the new catalog pin" },
  ],
  run: (ctx) => runStub(t3Update1, ctx),
};
