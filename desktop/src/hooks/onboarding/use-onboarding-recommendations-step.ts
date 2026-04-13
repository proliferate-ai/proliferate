import { useMemo, useState, useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { useModelRegistriesQuery } from "@anyharness/sdk-react";
import type { ModelRegistry } from "@anyharness/sdk";
import { compareChatLaunchKinds } from "@/config/chat-launch";
import type { OnboardingGoalId } from "@/config/onboarding";
import {
  listConfiguredSessionControlValues,
} from "@/lib/domain/chat/session-mode-control";
import { resolveModelForRegistry } from "@/lib/domain/chat/session-config";
import {
  resolveOnboardingRecommendation,
  type OnboardingRecommendation,
} from "@/lib/domain/onboarding/recommendation";
import { useHarnessStore } from "@/stores/sessions/harness-store";

export type OnboardingRecommendationStatus = "loading" | "ready" | "empty";

export interface OnboardingRecommendationsStepState {
  status: OnboardingRecommendationStatus;
  recommendation: OnboardingRecommendation | null;
  registries: readonly ModelRegistry[];
  agentOptions: Array<{ kind: string; displayName: string }>;
  modelOptionsByAgentKind: Record<string, Array<{ id: string; displayName: string }>>;
  modeOptionsByAgentKind: Record<string, Array<{ value: string; label: string }>>;
  selectedAgentKind: string | null;
  selectedModelId: string | null;
  selectedModeId: string | null;
  selectAgentKind: (kind: string) => void;
  selectModelId: (modelId: string) => void;
  selectModeId: (modeId: string | null) => void;
}

const EMPTY_REGISTRIES: ModelRegistry[] = [];

export function useOnboardingRecommendationsStep(args: {
  goalId: OnboardingGoalId | "";
}): OnboardingRecommendationsStepState {
  const { data: registries = EMPTY_REGISTRIES, isLoading } = useModelRegistriesQuery();
  const runtimeHealthy = useHarnessStore(
    useShallow((state) => state.connectionState === "healthy"),
  );

  const orderedRegistries = useMemo(
    () => [...registries].sort((left, right) =>
      compareChatLaunchKinds(left.kind, right.kind, left.displayName, right.displayName),
    ),
    [registries],
  );

  const usableRegistries = useMemo(
    () => orderedRegistries.filter((registry) => resolveModelForRegistry(registry, null)),
    [orderedRegistries],
  );

  const autoRecommendation = useMemo(
    () => resolveOnboardingRecommendation({
      goalId: args.goalId,
      availableRegistries: usableRegistries,
    }),
    [args.goalId, usableRegistries],
  );

  const [override, setOverride] = useState<OnboardingRecommendation | null>(null);

  // The user can edit the recommendation. Once they pick anything explicitly,
  // stop tracking autoRecommendation for that field.
  const selected: OnboardingRecommendation | null = override ?? autoRecommendation;

  const agentOptions = useMemo(
    () => usableRegistries.map((registry) => ({
      kind: registry.kind,
      displayName: registry.displayName,
    })),
    [usableRegistries],
  );

  const modelOptionsByAgentKind = useMemo(() => {
    const result: Record<string, Array<{ id: string; displayName: string }>> = {};
    for (const registry of usableRegistries) {
      result[registry.kind] = registry.models.map((model) => ({
        id: model.id,
        displayName: model.displayName,
      }));
    }
    return result;
  }, [usableRegistries]);

  const modeOptionsByAgentKind = useMemo(() => {
    const result: Record<string, Array<{ value: string; label: string }>> = {};
    for (const registry of usableRegistries) {
      const values = listConfiguredSessionControlValues(registry.kind, "mode");
      result[registry.kind] = values.map((value) => ({
        value: value.value,
        label: value.shortLabel ?? value.label,
      }));
    }
    return result;
  }, [usableRegistries]);

  const selectAgentKind = useCallback((kind: string) => {
    const nextSelection = resolveOnboardingRecommendation({
      goalId: args.goalId,
      availableRegistries: usableRegistries,
      forcedAgentKind: kind,
    });
    if (!nextSelection) return;
    setOverride(nextSelection);
  }, [args.goalId, usableRegistries]);

  const selectModelId = useCallback((modelId: string) => {
    setOverride((current) => {
      const base = current ?? autoRecommendation;
      if (!base) return current;
      return { ...base, modelId };
    });
  }, [autoRecommendation]);

  const selectModeId = useCallback((modeId: string | null) => {
    setOverride((current) => {
      const base = current ?? autoRecommendation;
      if (!base) return current;
      return { ...base, modeId };
    });
  }, [autoRecommendation]);

  const status: OnboardingRecommendationStatus = !runtimeHealthy || isLoading
    ? "loading"
    : usableRegistries.length === 0
      ? "empty"
      : "ready";

  return useMemo<OnboardingRecommendationsStepState>(() => ({
    status,
    recommendation: selected,
    registries: usableRegistries,
    agentOptions,
    modelOptionsByAgentKind,
    modeOptionsByAgentKind,
    selectedAgentKind: selected?.agentKind ?? null,
    selectedModelId: selected?.modelId ?? null,
    selectedModeId: selected?.modeId ?? null,
    selectAgentKind,
    selectModelId,
    selectModeId,
  }), [
    agentOptions,
    modeOptionsByAgentKind,
    modelOptionsByAgentKind,
    usableRegistries,
    selectAgentKind,
    selectModeId,
    selectModelId,
    selected,
    status,
  ]);
}
