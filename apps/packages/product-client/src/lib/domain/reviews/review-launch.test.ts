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
              modeId: "",
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
      modeId: "bypassPermissions",
    });
  });
});

function launchAgent(
  kind: string,
  modelId: string,
  unattendedModeId: string,
  defaultModelId = modelId,
): DesktopAgentLaunchAgent {
  return {
    kind,
    displayName: kind,
    defaultModelId,
    unattendedModeId,
    models: [
      launchModel(modelId, unattendedModeId, modelId === defaultModelId),
      ...(defaultModelId === modelId
        ? []
        : [launchModel(defaultModelId, unattendedModeId, true)]),
    ],
    launchControls: [],
  };
}

function launchModel(modelId: string, unattendedModeId: string, isDefault: boolean) {
  return {
    id: modelId,
    displayName: modelId,
    aliases: [],
    status: "active" as const,
    isDefault,
    availability: null,
    sessionDefaultControls: [],
    modeValues: [unattendedModeId],
    tuningControlValues: null,
  };
}
