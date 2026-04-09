import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRuntimeHarness, type RuntimeHarness } from "../../harness/runtime-harness.js";
import { AGENT_SETUP_TIMEOUT_MS, READY_AGENTS, REQUIRED_AGENTS } from "./helpers.js";

describe("runtime agent readiness", () => {
  let harness!: RuntimeHarness;

  beforeAll(async () => {
    harness = await createRuntimeHarness({ installAgents: REQUIRED_AGENTS });
  }, AGENT_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await harness?.close();
  });

  it("reports the configured ready agents", async () => {
    const agents = await harness.client.agents.list();

    for (const kind of READY_AGENTS) {
      const agent = agents.find((entry) => entry.kind === kind);
      expect(agent, `missing agent ${kind}`).toBeDefined();
      expect(agent?.readiness).toBe("ready");
    }
  });
});
