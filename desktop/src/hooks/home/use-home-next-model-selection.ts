import { useMemo } from "react";
import type { ModelRegistry } from "@anyharness/sdk";
import { useModelRegistriesQuery } from "@anyharness/sdk-react";
import { useShallow } from "zustand/react/shallow";
import { useAgentCatalog } from "@/hooks/agents/use-agent-catalog";
import {
  buildHomeNextModelGroups,
  resolveHomeModelAvailabilityState,
  resolveEffectiveHomeModelSelection,
  resolveHomeNextModelInfo,
  type HomeNextModelSelection,
} from "@/lib/domain/home/home-next-launch";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

const EMPTY_MODEL_REGISTRIES: ModelRegistry[] = [];

interface UseHomeNextModelSelectionArgs {
  modelSelectionOverride: HomeNextModelSelection | null;
}

export function useHomeNextModelSelection({
  modelSelectionOverride,
}: UseHomeNextModelSelectionArgs) {
  const {
    readyAgents,
    isLoading: agentsLoading,
    isError: agentsError,
    error: agentsQueryError,
  } = useAgentCatalog();
  const modelRegistriesQuery = useModelRegistriesQuery();
  const modelRegistries = modelRegistriesQuery.data ?? EMPTY_MODEL_REGISTRIES;
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelIdByAgentKind: state.defaultChatModelIdByAgentKind,
  })));

  const unselectedGroups = useMemo(
    () => buildHomeNextModelGroups(readyAgents, modelRegistries, null),
    [modelRegistries, readyAgents],
  );
  const effectiveModelSelection = useMemo(
    () => resolveEffectiveHomeModelSelection(
      unselectedGroups,
      modelSelectionOverride,
      preferences,
    ),
    [modelSelectionOverride, preferences, unselectedGroups],
  );
  const modelGroups = useMemo(
    () => buildHomeNextModelGroups(
      readyAgents,
      modelRegistries,
      effectiveModelSelection,
    ),
    [effectiveModelSelection, modelRegistries, readyAgents],
  );
  const selectedModel = useMemo(
    () => resolveHomeNextModelInfo(
      modelGroups,
      modelRegistries,
      effectiveModelSelection,
    ),
    [effectiveModelSelection, modelGroups, modelRegistries],
  );

  const isLoading = agentsLoading || modelRegistriesQuery.isLoading;
  const hasLoadError = agentsError || modelRegistriesQuery.isError;
  const hasLaunchableModel =
    modelGroups.length > 0
    && effectiveModelSelection !== null
    && selectedModel !== null;
  const modelAvailabilityState = useMemo(() => resolveHomeModelAvailabilityState({
    isLoading,
    hasLoadError,
    hasLaunchableModel,
  }), [hasLoadError, hasLaunchableModel, isLoading]);

  return {
    modelGroups,
    modelRegistries,
    effectiveModelSelection,
    selectedModel,
    isLoading,
    error: agentsQueryError ?? modelRegistriesQuery.error,
    modelAvailabilityState,
  };
}
