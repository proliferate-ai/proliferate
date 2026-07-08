import type { ScenarioDefinition } from "./types.js";
import { runStub } from "./stub-runner.js";

/**
 * T3-WT-1 — worktree workspaces, both lanes.
 * specs/developing/testing/scenarios.md#T3-WT-1
 */
export const t3Wt1: ScenarioDefinition = {
  id: "T3-WT-1",
  title: "worktree workspaces, both lanes",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-WT-1",
  lanes: ["local", "sandbox"],
  requiredEnv: [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
    "RELEASE_E2E_GITHUB_TEST_REPO",
    "RELEASE_E2E_GITHUB_TEST_TOKEN",
  ],
  plan: ({ runtimeLane }) =>
    runtimeLane === "local"
      ? [
          { description: "clone RELEASE_E2E_GITHUB_TEST_REPO locally as the base repo" },
          { description: "create a worktree workspace off the local repo via the local AnyHarness runtime" },
          { description: "assert the worktree was created on the right base branch" },
          { description: "open a session in the worktree" },
          { description: "make an edit in the worktree session; assert it does not appear in the base tree" },
        ]
      : [
          { description: "provision a cloud sandbox checked out against RELEASE_E2E_GITHUB_TEST_REPO" },
          { description: "create a worktree workspace inside the sandbox, off the sandbox's repo checkout" },
          { description: "assert the worktree was created on the right base branch" },
          { description: "open a session in the worktree" },
          { description: "make an edit in the worktree session; assert it does not appear in the base tree" },
        ],
  run: (ctx) => runStub(t3Wt1, ctx),
};
