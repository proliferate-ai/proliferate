import { describe, expect, it } from "vitest";
import type { ModelRegistry, ModelRegistryModel } from "@anyharness/sdk";
import {
  buildAcceptedOnboardingDefaultsUpdate,
  buildOnboardingFinalizerDefaultsUpdate,
} from "./defaults";

function model(id: string, displayName: string, isDefault: boolean): ModelRegistryModel {
  return {
    id,
    displayName,
    isDefault,
    status: "active",
  };
}

function registry(overrides: Partial<ModelRegistry> & { kind: string }): ModelRegistry {
  return {
    kind: overrides.kind,
    displayName: overrides.displayName ?? overrides.kind,
    defaultModelId: overrides.defaultModelId ?? "default-model",
    models: overrides.models ?? [model("default-model", "Default Model", true)],
  };
}

describe("onboarding defaults", () => {
  it("writes accepted recommendations to primary and per-harness model defaults", () => {
    const update = buildAcceptedOnboardingDefaultsUpdate(
      {
        defaultChatModelIdByAgentKind: {},
        defaultSessionModeByAgentKind: {},
      },
      {
        agentKind: "codex",
        modelId: "gpt-5.4",
        modeId: "auto",
      },
    );

    expect(update).toEqual({
      defaultChatAgentKind: "codex",
      defaultChatModelIdByAgentKind: {
        codex: "gpt-5.4",
      },
      defaultSessionModeByAgentKind: {
        codex: "auto",
      },
    });
  });

  it("finalizer backfills a missing primary map entry without changing primary", () => {
    const result = buildOnboardingFinalizerDefaultsUpdate({
      preferences: {
        onboardingPrimaryGoalId: "ship-features",
        defaultChatAgentKind: "codex",
        defaultChatModelIdByAgentKind: {},
        defaultSessionModeByAgentKind: {},
      },
      registries: [
        registry({
          kind: "codex",
          defaultModelId: "gpt-5.4",
          models: [model("gpt-5.4", "GPT-5.4", true)],
        }),
      ],
    });

    expect(result).toEqual({
      update: {
        defaultChatModelIdByAgentKind: {
          codex: "gpt-5.4",
        },
      },
      finalizedAgentKind: null,
    });
  });

  it("finalizer does not overwrite an explicit primary map entry", () => {
    const result = buildOnboardingFinalizerDefaultsUpdate({
      preferences: {
        onboardingPrimaryGoalId: "ship-features",
        defaultChatAgentKind: "codex",
        defaultChatModelIdByAgentKind: {
          codex: "gpt-5.4-mini",
        },
        defaultSessionModeByAgentKind: {},
      },
      registries: [
        registry({
          kind: "codex",
          defaultModelId: "gpt-5.4",
          models: [
            model("gpt-5.4", "GPT-5.4", true),
            model("gpt-5.4-mini", "Mini", false),
          ],
        }),
      ],
    });

    expect(result).toBeNull();
  });
});
