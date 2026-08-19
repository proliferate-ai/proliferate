import { describe, expect, it } from "vitest";
import type { DesktopAgentLaunchAgent } from "#product/lib/domain/agents/cloud-launch-catalog";
import { createStoredReviewKindDefaults } from "#product/lib/domain/reviews/review-config";
import { resolveOneClickReviewRequest } from "#product/lib/domain/reviews/review-launch";

describe("resolveOneClickReviewRequest", () => {
  it("uses the stored reviewer's target catalog default instead of the parent agent's", () => {
    const result = resolveOneClickReviewRequest({
      kind: "plan",
      parentSessionId: "parent-session",
      parentSlot: {
        agentKind: "codex",
        modelId: "gpt-5.4",
      },
      launchAgents: [
        launchAgent("codex", "gpt-5.4", "full-access"),
        launchAgent("claude", "sonnet", "bypassPermissions", "opus"),
      ],
      reviewDefaultsByKind: {
        plan: {
          ...createStoredReviewKindDefaults(),
          reviewers: {
            mode: "custom",
            items: [{
              id: "plan-skeptic",
              label: "Plan skeptic",
              prompt: "Review the plan.",
              agentKind: "claude",
              modelId: "sonnet",
              controlValues: {},
            }],
          },
        },
        code: null,
      },
      reviewPersonalitiesByKind: { plan: [], code: [] },
    });

    expect(result.error).toBeNull();
    expect(result.request?.reviewers[0]).toMatchObject({
      agentKind: "claude",
      modelId: "sonnet",
      controlValues: { mode: "bypassPermissions" },
    });
  });
});

function launchAgent(
  kind: string,
  modelId: string,
  defaultModeId: string,
  defaultModelId = modelId,
): DesktopAgentLaunchAgent {
  return {
    kind,
    displayName: kind,
    defaultModelId,
    models: [
      launchModel(modelId, modelId === defaultModelId),
      ...(defaultModelId === modelId
        ? []
        : [launchModel(defaultModelId, true)]),
    ],
    launchControls: [{
      key: "mode",
      label: "Access",
      type: "select",
      defaultValue: defaultModeId,
      phase: "create_session",
      surfaces: { start: true, session: true, automation: true, settings: true },
      apply: { queueBeforeMaterialized: false },
      missingLiveConfigPolicy: "block_prompt",
      valueSource: "inline",
      values: [{ value: defaultModeId, label: defaultModeId, isDefault: true }],
      queueWhileMaterializing: false,
      mutableAfterMaterialized: true,
    }],
  };
}

function launchModel(modelId: string, isDefault: boolean) {
  return {
    id: modelId,
    displayName: modelId,
    aliases: [],
    status: "active" as const,
    isDefault,
    availability: null,
    sessionDefaultControls: [],
    modeValues: null,
    tuningControlValues: null,
  };
}
