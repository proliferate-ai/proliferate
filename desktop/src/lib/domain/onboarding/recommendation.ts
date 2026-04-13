import type { ModelRegistry } from "@anyharness/sdk";
import { compareChatLaunchKinds } from "@/config/chat-launch";
import {
  ONBOARDING_GOAL_AGENT_PREFERENCES,
  type OnboardingGoalId,
} from "@/config/onboarding";
import { resolveEffectiveConfiguredSessionControlValue } from "@/lib/domain/chat/session-mode-control";
import { resolveModelForRegistry } from "@/lib/domain/chat/session-config";

export interface OnboardingRecommendation {
  agentKind: string;
  modelId: string;
  modeId: string | null;
}

// Pick the recommended agent kind for a goal, restricted to agents whose
// registries are actually available. Falls back to the canonical chat-launch
// ordering so the caller always gets an installable recommendation when at
// least one registry exists.
export function pickRecommendedAgentKind(
  goalId: OnboardingGoalId | "",
  availableRegistries: readonly ModelRegistry[],
): string | null {
  const usableKinds = availableRegistries
    .filter((registry) => registry.models.length > 0)
    .map((registry) => registry.kind);
  if (usableKinds.length === 0) {
    return null;
  }

  const availableSet = new Set(usableKinds);

  if (goalId) {
    const preference = ONBOARDING_GOAL_AGENT_PREFERENCES[goalId];
    for (const kind of preference) {
      if (availableSet.has(kind)) {
        return kind;
      }
    }
  }

  const sorted = [...availableRegistries]
    .filter((registry) => registry.models.length > 0)
    .sort((left, right) =>
      compareChatLaunchKinds(
        left.kind,
        right.kind,
        left.displayName,
        right.displayName,
      ),
    );
  return sorted[0]?.kind ?? null;
}

export function resolveOnboardingRecommendation(
  args: {
    goalId: OnboardingGoalId | "";
    availableRegistries: readonly ModelRegistry[];
    forcedAgentKind?: string | null;
  },
): OnboardingRecommendation | null {
  const forcedRegistry = args.forcedAgentKind
    ? args.availableRegistries.find((registry) => registry.kind === args.forcedAgentKind)
    : null;
  const agentKind = forcedRegistry && resolveModelForRegistry(forcedRegistry, null)
    ? forcedRegistry.kind
    : pickRecommendedAgentKind(args.goalId, args.availableRegistries);
  if (!agentKind) {
    return null;
  }

  const registry = args.availableRegistries.find((r) => r.kind === agentKind);
  if (!registry) {
    return null;
  }

  const model = resolveModelForRegistry(registry, null);
  if (!model) {
    return null;
  }

  return {
    agentKind,
    modelId: model.id,
    modeId:
      resolveEffectiveConfiguredSessionControlValue(agentKind, "mode", null)?.value
      ?? null,
  };
}
