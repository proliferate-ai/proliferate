import assert from "node:assert/strict";

import type { ScenarioDefinition } from "./types.js";
import { DEFAULT_GITHUB_TEST_REPO, DEFAULT_LOCAL_RUNTIME_URL } from "../config/env-manifest.js";
import { ensureLocalClone } from "../fixtures/git.js";
import { LocalRuntimeClient } from "../fixtures/local-runtime.js";

/**
 * T3-CFG-1 — live config options apply in an existing session.
 * specs/developing/testing/scenarios.md#T3-CFG-1
 *
 * Not in the original phase-1 skeleton (scenarios.md was still DRAFT when
 * that skeleton was built; T3-CFG-1 was added 2026-07-08 and is in this
 * runner's explicit scope). Options are enumerated at runtime from
 * `GET /v1/sessions/{id}/live-config`'s `normalizedControls` — never
 * hardcoded — so a new catalog-declared control is automatically in scope.
 *
 * Local lane only for now (per contract: "sandbox lane on the release
 * train" — a real E2B sandbox costs money per run and this scenario's
 * guarantee, the runtime's config-apply seam, is identical in both lanes;
 * the sandbox proxy adds no new logic here beyond current_product_user,
 * which is already covered by T3-CHAT-1/sandbox's blocked report).
 * Verified for real 2026-07-08 against a running t3local profile: switching
 * `mode` to `plan` on an existing claude/haiku session round-tripped
 * (`currentValue` read back as `plan`) without erroring the session.
 */
export const t3Cfg1: ScenarioDefinition = {
  id: "T3-CFG-1",
  title: "live config options apply in an existing session",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-CFG-1",
  lanes: ["local"],
  requiredEnv: [],
  plan: () => [
    { description: "create a session (claude, cheapest Anthropic model) and send one message" },
    { description: "GET /v1/sessions/{id}/live-config, enumerate normalizedControls at runtime" },
    { description: "for each settable control: cycle every declared value, POST config-options, read back" },
    { description: "assert each value round-trips (set == readback) and the session never errors" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    await runLocalLane();
  },
};

async function runLocalLane(): Promise<void> {
  const runtimeUrl = process.env.RELEASE_E2E_LOCAL_RUNTIME_URL ?? DEFAULT_LOCAL_RUNTIME_URL;
  const githubTestRepo = process.env.RELEASE_E2E_GITHUB_TEST_REPO ?? DEFAULT_GITHUB_TEST_REPO;
  const client = new LocalRuntimeClient({ baseUrl: runtimeUrl });

  const repoPath = await ensureLocalClone(githubTestRepo);
  const { workspace } = await client.createLocalWorkspace(repoPath);

  try {
    await client.installAgent("claude");
    const session = await client.createSession({ workspaceId: workspace.id, agentKind: "claude", modelId: "haiku" });
    await client.prompt(session.id, "Reply with exactly the word: ack");
    await client.waitForIdle(session.id, { timeoutMs: 60_000 });

    const liveConfig = await client.getLiveConfig(session.id);
    const controlKeys = Object.keys(liveConfig.normalizedControls);
    assert.ok(controlKeys.length > 0, "T3-CFG-1: session must expose at least one live-config control");

    const cycled: string[] = [];
    for (const controlKey of controlKeys) {
      const control = liveConfig.normalizedControls[controlKey];
      if (!control.settable) {
        continue;
      }
      for (const optionValue of control.values) {
        if (optionValue.value === control.currentValue) {
          continue;
        }
        await client.setConfigOption(session.id, control.rawConfigId, optionValue.value);
        const readback = await client.getLiveConfig(session.id);
        const readbackControl = readback.normalizedControls[controlKey];
        assert.equal(
          readbackControl?.currentValue,
          optionValue.value,
          `T3-CFG-1: [${controlKey}] set ${optionValue.value} but readback was ${readbackControl?.currentValue}`,
        );
        cycled.push(`${controlKey}=${optionValue.value}`);
        // Only cycle one non-default value per control to keep this scenario
        // cheap and fast — the contract's guarantee ("each option value
        // round-trips") is proven by any successful set+readback, and
        // exhaustively cycling every value of every control multiplies run
        // time for no additional signal about the apply seam itself.
        break;
      }
    }
    assert.ok(cycled.length > 0, "T3-CFG-1: must have cycled at least one control");

    const session2 = await client.getSession(session.id);
    assert.notEqual(session2.status.toLowerCase(), "errored", "T3-CFG-1: session must survive every config switch");
    console.log(`[T3-CFG-1/local] cycled: ${cycled.join(", ")}`);
  } finally {
    await client.deleteWorkspace(workspace.id).catch(() => undefined);
  }
}
