import { useMemo } from "react";
import { useAgentLaunchOptionsQuery } from "@anyharness/sdk-react";
import { useShallow } from "zustand/react/shallow";
import { useAgentCatalog } from "#product/hooks/agents/derived/use-agent-catalog";
import {
  projectHarnessLaunchOptions,
  type DesktopLaunchModelRegistry as ModelRegistry,
} from "#product/lib/domain/agents/cloud-launch-catalog";
import {
  buildHomeNextModelGroups,
  resolveHomeModelAvailabilityState,
  resolveEffectiveHomeModelSelection,
  resolveHomeNextModelInfo,
  type HomeNextModelSelection,
  type HomeNextRepoLaunchKind,
} from "#product/lib/domain/home/home-next-launch";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";

const EMPTY_MODEL_REGISTRIES: ModelRegistry[] = [];

interface UseHomeNextModelSelectionArgs {
  modelSelectionOverride: HomeNextModelSelection | null;
  repoLaunchKind?: HomeNextRepoLaunchKind | null;
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
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelIdByAgentKind: state.defaultChatModelIdByAgentKind,
  })));
  const requestedHarnessKind = modelSelectionOverride?.kind
    || preferences.defaultChatAgentKind
    || readyAgents[0]?.kind
    || null;
  const runtimeLaunchOptions = useAgentLaunchOptionsQuery({ harnessKind: requestedHarnessKind });
  const modelRegistries = useMemo(
    () => {
      const agent = runtimeLaunchOptions.data
        ? projectHarnessLaunchOptions(runtimeLaunchOptions.data)
        : null;
      return agent ? [{
        kind: agent.kind,
        displayName: agent.displayName,
        defaultModelId: agent.defaultModelId,
        models: agent.models,
      }] : EMPTY_MODEL_REGISTRIES;
    },
    [runtimeLaunchOptions.data],
  );
  const readyAgentsForLaunch = useMemo(() => modelRegistries.map((registry) => ({
    kind: registry.kind,
    displayName: registry.displayName,
    readiness: "ready" as const,
  })), [modelRegistries]);

  const unselectedGroups = useMemo(
    () => buildHomeNextModelGroups(readyAgentsForLaunch, modelRegistries, null),
    [readyAgentsForLaunch, modelRegistries],
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
      readyAgentsForLaunch,
      modelRegistries,
      effectiveModelSelection,
    ),
    [effectiveModelSelection, readyAgentsForLaunch, modelRegistries],
  );
  const selectedModel = useMemo(
    () => resolveHomeNextModelInfo(
      modelGroups,
      modelRegistries,
      effectiveModelSelection,
    ),
    [effectiveModelSelection, modelGroups, modelRegistries],
  );

  const isLoading =
    agentsLoading
    || runtimeLaunchOptions.isLoading;
  const hasLoadError =
    agentsError
    || runtimeLaunchOptions.isError;
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
    error: agentsQueryError
      ?? runtimeLaunchOptions.error,
    modelAvailabilityState,
  };
}
