import type { ScenarioDefinition } from "./types.js";
import { runStub } from "./stub-runner.js";

/**
 * T3-CHAT-1 — every harness x its cheapest model, via the gateway.
 * specs/developing/testing/scenarios.md#T3-CHAT-1
 *
 * Gateway test-model set (per scenarios.md): one cheapest model per provider
 * family, resolved against the catalog at build time — Haiku-class
 * (Claude Code / OpenCode default lane), cheapest Codex tier, Flash-class
 * Gemini CLI, cheap xAI tier (Grok), one OSS/aggregator lane (e.g. GLM).
 */
export const t3Chat1: ScenarioDefinition = {
  id: "T3-CHAT-1",
  title: "every harness x its cheapest model, via the gateway",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-CHAT-1",
  lanes: ["local", "sandbox"],
  requiredEnv: [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_GATEWAY_TEST_KEY",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
  ],
  plan: ({ runtimeLane, agents }) => {
    const harnesses = agents.includes("all")
      ? ["claude", "codex", "gemini-cli", "grok", "opencode"]
      : [...agents];
    return harnesses.flatMap((harness) => [
      {
        description: `[${harness}] assert installed CLI version == catalog pin (before chat), ${
          runtimeLane === "local" ? "in the local runtime home" : "inside the sandbox"
        }`,
      },
      { description: `[${harness}] create session using its cheapest model via RELEASE_E2E_GATEWAY_TEST_KEY` },
      { description: `[${harness}] send one message, await turn_ended` },
      { description: `[${harness}] assert non-empty assistant reply arrived` },
      { description: `[${harness}] close and reopen the session, assert transcript persists` },
    ]);
  },
  run: (ctx) => runStub(t3Chat1, ctx),
};
