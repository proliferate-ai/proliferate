import { useMemo } from "react";
import { useAgentLaunchOptionsQuery } from "@anyharness/sdk-react";
import { useShallow } from "zustand/react/shallow";
import { useAgentCatalog } from "#product/hooks/agents/derived/use-agent-catalog";
import { useCloudLaunchModelRegistries } from "#product/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import {
  mergeRuntimeLaunchOptionsIntoDesktopLaunchModelRegistries,
  type DesktopLaunchModelRegistry as ModelRegistry,
} from "#product/lib/domain/agents/cloud-launch-catalog";
import type { AgentCatalogSummary } from "#product/lib/domain/agents/model-options";
import { filterVisibleModelRegistries } from "#product/lib/domain/chat/models/model-visibility";
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
  repoLaunchKind = null,
}: UseHomeNextModelSelectionArgs) {
  const {
    readyAgents,
    isLoading: agentsLoading,
    isError: agentsError,
    error: agentsQueryError,
  } = useAgentCatalog();
  const isCloudLaunchTarget = repoLaunchKind === "cloud";
  const modelRegistriesQuery = useCloudLaunchModelRegistries();
  const runtimeLaunchOptions = useAgentLaunchOptionsQuery();
  const modelRegistries = useMemo(
    () => mergeRuntimeLaunchOptionsIntoDesktopLaunchModelRegistries(
      modelRegistriesQuery.data ?? EMPTY_MODEL_REGISTRIES,
      isCloudLaunchTarget ? null : runtimeLaunchOptions.data?.agents ?? null,
    ),
    [isCloudLaunchTarget, modelRegistriesQuery.data, runtimeLaunchOptions.data?.agents],
  );
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelIdByAgentKind: state.defaultChatModelIdByAgentKind,
    chatModelVisibilityOverridesByAgentKind:
      state.chatModelVisibilityOverridesByAgentKind,
  })));
  const visibleModelRegistries = useMemo(
    () => filterVisibleModelRegistries({
      modelRegistries,
      overrides: preferences.chatModelVisibilityOverridesByAgentKind,
      selected: null,
    }),
    [modelRegistries, preferences.chatModelVisibilityOverridesByAgentKind],
  );
  const readyAgentsForLaunch = useMemo<AgentCatalogSummary[]>(() => {
    if (!isCloudLaunchTarget) {
      return readyAgents;
    }
    return buildCloudReadyAgentSummaries({ modelRegistries });
  }, [
    isCloudLaunchTarget,
    modelRegistries,
    readyAgents,
  ]);

  const unselectedGroups = useMemo(
    () => buildHomeNextModelGroups(readyAgentsForLaunch, visibleModelRegistries, null),
    [readyAgentsForLaunch, visibleModelRegistries],
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
      visibleModelRegistries,
      effectiveModelSelection,
    ),
    [effectiveModelSelection, readyAgentsForLaunch, visibleModelRegistries],
  );
  const selectedModel = useMemo(
    () => resolveHomeNextModelInfo(
      modelGroups,
      visibleModelRegistries,
      effectiveModelSelection,
    ),
    [effectiveModelSelection, modelGroups, visibleModelRegistries],
  );

  const isLoading =
    agentsLoading
    || modelRegistriesQuery.isLoading
    || (!isCloudLaunchTarget && runtimeLaunchOptions.isLoading);
  const hasLoadError =
    agentsError
    || modelRegistriesQuery.isError
    || (!isCloudLaunchTarget && runtimeLaunchOptions.isError);
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
    modelRegistries: visibleModelRegistries,
    effectiveModelSelection,
    selectedModel,
    isLoading,
    error: agentsQueryError
      ?? modelRegistriesQuery.error
      ?? (isCloudLaunchTarget ? null : runtimeLaunchOptions.error),
    modelAvailabilityState,
  };
}

function buildCloudReadyAgentSummaries({
  modelRegistries,
}: {
  modelRegistries: readonly ModelRegistry[];
}): AgentCatalogSummary[] {
  return modelRegistries.map((registry) => ({
    kind: registry.kind,
    displayName: registry.displayName,
    readiness: "ready",
  }));
}
