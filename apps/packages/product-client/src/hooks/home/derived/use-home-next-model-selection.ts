import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAgentCatalog } from "#product/hooks/agents/derived/use-agent-catalog";
import {
  useHomeTargetAgentLaunchOptions,
  useHomeTargetOtherAgentsLaunchOptions,
} from "#product/hooks/home/derived/use-home-target-agent-launch-options";
import {
  projectHarnessLaunchOptions,
  type DesktopLaunchModelRegistry as ModelRegistry,
} from "#product/lib/domain/agents/cloud-launch-catalog";
import {
  buildHomeNextModelGroups,
  resolveHomeModelAvailabilityState,
  resolveEffectiveHomeModelSelection,
  resolveHomeNextModelInfo,
  type HomeLaunchTarget,
  type HomeNextModelSelection,
} from "#product/lib/domain/home/home-next-launch";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";

const EMPTY_MODEL_REGISTRIES: ModelRegistry[] = [];

interface UseHomeNextModelSelectionArgs {
  modelSelectionOverride: HomeNextModelSelection | null;
  launchTarget: HomeLaunchTarget | null;
}

export function useHomeNextModelSelection({
  modelSelectionOverride,
  launchTarget,
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
    || (launchTarget?.kind === "cloud" ? null : readyAgents[0]?.kind)
    || null;
  const targetLaunchOptions = useHomeTargetAgentLaunchOptions({
    harnessKind: requestedHarnessKind,
    launchTarget,
  });
  // Every OTHER ready harness on the same target stays pickable too; the
  // requested kind's query keeps driving loading/error/availability. Additive
  // best-effort: an unresolved kind is absent until its observation arrives.
  const otherReadyHarnessKinds = useMemo(
    () => readyAgents
      .map((agent) => agent.kind)
      .filter((kind) => kind !== requestedHarnessKind),
    [readyAgents, requestedHarnessKind],
  );
  const otherLaunchOptions = useHomeTargetOtherAgentsLaunchOptions({
    harnessKinds: otherReadyHarnessKinds,
    launchTarget,
  });
  const modelRegistries = useMemo(
    () => {
      const registries = [targetLaunchOptions.data, ...otherLaunchOptions]
        .flatMap((response) => {
          const agent = response ? projectHarnessLaunchOptions(response) : null;
          return agent ? [{
            kind: agent.kind,
            displayName: agent.displayName,
            defaultModelId: agent.defaultModelId,
            models: agent.models,
          }] : [];
        });
      return registries.length > 0 ? registries : EMPTY_MODEL_REGISTRIES;
    },
    [otherLaunchOptions, targetLaunchOptions.data],
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
    (launchTarget?.kind === "cloud" ? false : agentsLoading)
    || targetLaunchOptions.isLoading;
  const hasLoadError =
    (launchTarget?.kind === "cloud" ? false : agentsError)
    || targetLaunchOptions.isError;
  const hasLaunchableModel =
    modelGroups.length > 0
    && effectiveModelSelection !== null
    && selectedModel !== null;
  const modelAvailabilityState = useMemo(() => (
    targetLaunchOptions.isTargetUnobserved
      ? "target_unobserved" as const
      : resolveHomeModelAvailabilityState({
        isLoading,
        hasLoadError,
        hasLaunchableModel,
      })
  ), [hasLoadError, hasLaunchableModel, isLoading, targetLaunchOptions.isTargetUnobserved]);

  return {
    modelGroups,
    modelRegistries,
    effectiveModelSelection,
    selectedModel,
    isLoading,
    error: (launchTarget?.kind === "cloud" ? null : agentsQueryError)
      ?? targetLaunchOptions.error,
    modelAvailabilityState,
  };
}
