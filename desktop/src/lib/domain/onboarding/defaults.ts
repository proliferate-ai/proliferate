import type { ModelRegistry } from "@anyharness/sdk";
import type { OnboardingGoalId } from "@/config/onboarding";
import { withUpdatedDefaultModelIdByAgentKind } from "@/lib/domain/agents/model-options";
import { resolveModelForRegistry } from "@/lib/domain/chat/session-config";
import { resolveOnboardingRecommendation } from "@/lib/domain/onboarding/recommendation";

export interface OnboardingDefaultsPreferences {
  onboardingPrimaryGoalId: OnboardingGoalId | "";
  defaultChatAgentKind: string;
  defaultChatModelIdByAgentKind: Record<string, string>;
  defaultSessionModeByAgentKind: Record<string, string>;
}

export interface AcceptedOnboardingDefaultsInput {
  agentKind: string;
  modelId: string;
  modeId: string | null;
}

export function buildAcceptedOnboardingDefaultsUpdate(
  preferences: Pick<
    OnboardingDefaultsPreferences,
    "defaultChatModelIdByAgentKind" | "defaultSessionModeByAgentKind"
  >,
  input: AcceptedOnboardingDefaultsInput,
) {
  const nextDefaultModes = input.modeId && input.agentKind
    ? {
      ...preferences.defaultSessionModeByAgentKind,
      [input.agentKind]: input.modeId,
    }
    : preferences.defaultSessionModeByAgentKind;
  const nextDefaultModels = input.agentKind && input.modelId
    ? withUpdatedDefaultModelIdByAgentKind(
      preferences.defaultChatModelIdByAgentKind,
      input.agentKind,
      input.modelId,
    )
    : preferences.defaultChatModelIdByAgentKind;

  return {
    ...(input.agentKind ? { defaultChatAgentKind: input.agentKind } : {}),
    defaultChatModelIdByAgentKind: nextDefaultModels,
    defaultSessionModeByAgentKind: nextDefaultModes,
  };
}

export function buildOnboardingFinalizerDefaultsUpdate({
  preferences,
  registries,
}: {
  preferences: OnboardingDefaultsPreferences;
  registries: readonly ModelRegistry[];
}): {
  update: Partial<Pick<
    OnboardingDefaultsPreferences,
    "defaultChatAgentKind" | "defaultChatModelIdByAgentKind" | "defaultSessionModeByAgentKind"
  >>;
  finalizedAgentKind: string | null;
} | null {
  const primaryRegistry = preferences.defaultChatAgentKind
    ? registries.find((registry) => registry.kind === preferences.defaultChatAgentKind) ?? null
    : null;
  const primaryModelId = preferences.defaultChatAgentKind
    ? preferences.defaultChatModelIdByAgentKind[preferences.defaultChatAgentKind] ?? null
    : null;
  const effectivePrimaryModel = primaryRegistry
    ? resolveModelForRegistry(primaryRegistry, primaryModelId)
    : null;

  if (preferences.defaultChatAgentKind && effectivePrimaryModel) {
    if (primaryModelId) {
      return null;
    }
    return {
      update: {
        defaultChatModelIdByAgentKind: withUpdatedDefaultModelIdByAgentKind(
          preferences.defaultChatModelIdByAgentKind,
          preferences.defaultChatAgentKind,
          effectivePrimaryModel.id,
        ),
      },
      finalizedAgentKind: null,
    };
  }

  const recommendation = resolveOnboardingRecommendation({
    goalId: preferences.onboardingPrimaryGoalId,
    availableRegistries: registries,
    forcedAgentKind: preferences.defaultChatAgentKind || null,
  });
  if (!recommendation) {
    return null;
  }

  const nextDefaultModes = recommendation.modeId
    ? {
      ...preferences.defaultSessionModeByAgentKind,
      [recommendation.agentKind]:
        preferences.defaultSessionModeByAgentKind[recommendation.agentKind]
        ?? recommendation.modeId,
    }
    : preferences.defaultSessionModeByAgentKind;
  const nextDefaultModels = preferences.defaultChatModelIdByAgentKind[recommendation.agentKind]
    ? preferences.defaultChatModelIdByAgentKind
    : withUpdatedDefaultModelIdByAgentKind(
      preferences.defaultChatModelIdByAgentKind,
      recommendation.agentKind,
      recommendation.modelId,
    );

  return {
    update: {
      defaultChatAgentKind: recommendation.agentKind,
      defaultChatModelIdByAgentKind: nextDefaultModels,
      defaultSessionModeByAgentKind: nextDefaultModes,
    },
    finalizedAgentKind: recommendation.agentKind,
  };
}
