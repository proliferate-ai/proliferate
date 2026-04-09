import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRuntimeHarness, type RuntimeHarness } from "../../harness/runtime-harness.js";
import {
  AGENT_SETUP_TIMEOUT_MS,
  READY_AGENTS,
  REQUIRED_AGENTS,
  describeTranscript,
  getSessionPromptTimeoutMs,
  getSessionTestTimeoutMs,
  getToolCalls,
  hasReadyResponse,
  pickInvalidConfigId,
} from "./helpers.js";

describe("runtime agent session turns", () => {
  let harness!: RuntimeHarness;

  beforeAll(async () => {
    harness = await createRuntimeHarness({ installAgents: REQUIRED_AGENTS });
  }, AGENT_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await harness?.close();
  });

  for (const agentKind of READY_AGENTS) {
    it(`can create a session, reject invalid config, and complete a turn for ${agentKind}`, async () => {
      const workspace = await harness.createTestWorkspace(`session-${agentKind}`);

      try {
        const resolved = await harness.client.workspaces.resolveFromPath(workspace.path);
        const session = await harness.client.sessions.create({
          workspaceId: resolved.id,
          agentKind,
        });

        const liveConfig = await harness.client.sessions.getLiveConfig(session.id);
        expect(liveConfig.liveConfig).toBeTruthy();
        const invalidConfigId = pickInvalidConfigId(liveConfig.liveConfig, agentKind);
        await expect(
          harness.client.sessions.setConfigOption(session.id, {
            configId: invalidConfigId,
            value: "__invalid__",
          }),
        ).rejects.toThrow();

        const result = await harness.promptAndCollect(
          session.id,
          "Reply with exactly the single word READY. Do not use any tools.",
          { timeoutMs: getSessionPromptTimeoutMs(agentKind) },
        );

        expect(result.events.some((event) => event.event.type === "turn_started")).toBe(true);
        expect(result.events.some((event) => event.event.type === "turn_ended")).toBe(true);
        expect(result.transcript.turnOrder.length).toBeGreaterThan(0);
        expect(result.transcript.isStreaming).toBe(false);
        expect(result.transcript.openAssistantItemId).toBeNull();
        expect(result.transcript.openThoughtItemId).toBeNull();
        expect(
          hasReadyResponse(result.transcript),
          describeTranscript(result.transcript),
        ).toBe(true);
        expect(
          getToolCalls(result.transcript).length,
          describeTranscript(result.transcript),
        ).toBe(0);
      } finally {
        await workspace.cleanup();
      }
    }, getSessionTestTimeoutMs(agentKind));
  }
});
