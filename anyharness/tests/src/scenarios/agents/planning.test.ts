import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deriveCanonicalPlan } from "@anyharness/sdk";

import { createRuntimeHarness, type RuntimeHarness } from "../../harness/runtime-harness.js";
import {
  AGENT_SETUP_TIMEOUT_MS,
  PLANNING_CASES,
  PLANNING_MODE_AGENTS,
  READY_AGENTS,
  REQUIRED_AGENTS,
  describeTranscript,
  findClaudeModeSwitchTool,
  findClaudeExitPlanModeTool,
  getPlanningPromptTimeoutMs,
  getPlanningTestTimeoutMs,
  hasPlanFileWrite,
  hasGeminiPlanningBehavior,
  isPlanEnvelope,
  switchToPlanMode,
} from "./helpers.js";

describe("runtime agent planning compatibility", () => {
  let harness!: RuntimeHarness;

  beforeAll(async () => {
    harness = await createRuntimeHarness({ installAgents: REQUIRED_AGENTS });
  }, AGENT_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await harness?.close();
  });

  for (const agentKind of PLANNING_MODE_AGENTS) {
    it(`switches to planning mode in live config for ${agentKind}`, async () => {
      const workspace = await harness.createTestWorkspace(`planning-config-${agentKind}`);

      try {
        const resolved = await harness.client.workspaces.resolveFromPath(workspace.path);
        const session = await harness.client.sessions.create({
          workspaceId: resolved.id,
          agentKind,
        });

        await switchToPlanMode(harness, session.id, agentKind);

        const refreshedConfig = await harness.client.sessions.getLiveConfig(session.id);
        expect(refreshedConfig.liveConfig?.normalizedControls.mode?.currentValue).toBe("plan");
      } finally {
        await workspace.cleanup();
      }
    });
  }

  for (const planningCase of PLANNING_CASES.filter((item) => READY_AGENTS.includes(item.agentKind))) {
    it(`emits planning artifacts end-to-end for ${planningCase.agentKind}`, async () => {
      const workspace = await harness.createTestWorkspace(`planning-${planningCase.agentKind}`);

      try {
        const resolved = await harness.client.workspaces.resolveFromPath(workspace.path);
        const session = await harness.client.sessions.create({
          workspaceId: resolved.id,
          agentKind: planningCase.agentKind,
        });

        if (planningCase.usesPlanningMode) {
          await switchToPlanMode(harness, session.id, planningCase.agentKind);
        }

        const result = await harness.promptAndCollectUntil(session.id, planningCase.prompt, {
          timeoutMs: getPlanningPromptTimeoutMs(planningCase.agentKind),
          stopWhen: (envelope) =>
            isPlanEnvelope(envelope)
            || envelope.event.type === "permission_requested"
            || envelope.event.type === "turn_ended"
            || envelope.event.type === "session_ended",
        });

        if (planningCase.expectedPlanSource === "structured_plan") {
          const canonicalPlan = deriveCanonicalPlan(result.transcript);
          expect(
            canonicalPlan?.sourceKind,
            `expected structured canonical plan for ${planningCase.agentKind}\n${describeTranscript(result.transcript)}`,
          ).toBe("structured_plan");
          expect(
            canonicalPlan?.entries.length ?? 0,
            `expected structured plan entries for ${planningCase.agentKind}\n${describeTranscript(result.transcript)}`,
          ).toBeGreaterThan(0);
        } else if (planningCase.expectedPlanSource === "mode_switch") {
          const canonicalPlan = deriveCanonicalPlan(result.transcript);
          if (canonicalPlan?.sourceKind === "mode_switch") {
            expect(
              findClaudeExitPlanModeTool(result.transcript),
              `expected Claude ExitPlanMode tool call for ${planningCase.agentKind}\n${describeTranscript(result.transcript)}`,
            ).toBeTruthy();
            expect(
              canonicalPlan.body?.trim().length ?? 0,
              `expected non-empty presented plan for ${planningCase.agentKind}\n${describeTranscript(result.transcript)}`,
            ).toBeGreaterThan(0);
          } else {
            const pendingModeSwitch = findClaudeModeSwitchTool(result.transcript);
            expect(
              pendingModeSwitch,
              `expected mode-switch planning interaction for ${planningCase.agentKind}\n${describeTranscript(result.transcript)}`,
            ).toBeTruthy();
            expect(
              hasPlanFileWrite(result.transcript),
              `expected Claude plan file write for ${planningCase.agentKind}\n${describeTranscript(result.transcript)}`,
            ).toBe(true);
          }
        } else {
          expect(
            hasGeminiPlanningBehavior(result.transcript),
            `expected planning behavior for ${planningCase.agentKind}\n${describeTranscript(result.transcript)}`,
          ).toBe(true);
        }
      } finally {
        await workspace.cleanup();
      }
    }, getPlanningTestTimeoutMs(planningCase.agentKind));
  }
});
