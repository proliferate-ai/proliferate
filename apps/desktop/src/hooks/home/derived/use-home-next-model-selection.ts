import { useMemo } from "react";
import { useAgentLaunchOptionsQuery } from "@anyharness/sdk-react";
import { useShallow } from "zustand/react/shallow";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";
import { useCloudLaunchModelRegistries } from "@/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import { useCloudTargets } from "@/hooks/access/cloud/targets/use-cloud-targets";
import { useSandboxAgentAuthSelections } from "@proliferate/cloud-sdk-react/hooks/agent-auth";
import {
  mergeRuntimeLaunchOptionsIntoDesktopLaunchModelRegistries,
  type DesktopLaunchModelRegistry as ModelRegistry,
} from "@/lib/domain/agents/cloud-launch-catalog";
import type {
  CloudTargetSummary,
  SandboxAgentAuthSelection,
} from "@proliferate/cloud-sdk";
import type { AgentCatalogSummary } from "@/lib/domain/agents/model-options";
import { filterVisibleModelRegistries } from "@/lib/domain/chat/models/model-visibility";
import {
  buildHomeNextModelGroups,
  resolveHomeModelAvailabilityState,
  resolveEffectiveHomeModelSelection,
  resolveHomeNextModelInfo,
  type HomeNextModelSelection,
  type HomeNextRepoLaunchKind,
} from "@/lib/domain/home/home-next-launch";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

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
  const cloudTargetsQuery = useCloudTargets(isCloudLaunchTarget);
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
  const primaryCloudTarget = useMemo(
    () => resolvePrimaryManagedCloudTarget(cloudTargetsQuery.data ?? []),
    [cloudTargetsQuery.data],
  );
  const cloudAgentSelectionsQuery = useSandboxAgentAuthSelections(
    primaryCloudTarget?.sandboxProfileId ?? null,
    isCloudLaunchTarget,
  );
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
    return buildCloudReadyAgentSummaries({
      selections: cloudAgentSelectionsQuery.data ?? [],
      modelRegistries,
    });
  }, [
    cloudAgentSelectionsQuery.data,
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
    || (!isCloudLaunchTarget && runtimeLaunchOptions.isLoading)
    || (isCloudLaunchTarget && cloudTargetsQuery.isLoading)
    || (isCloudLaunchTarget && cloudAgentSelectionsQuery.isLoading);
  const hasLoadError =
    agentsError
    || modelRegistriesQuery.isError
    || (!isCloudLaunchTarget && runtimeLaunchOptions.isError)
    || (isCloudLaunchTarget && cloudTargetsQuery.isError)
    || (isCloudLaunchTarget && cloudAgentSelectionsQuery.isError);
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

function resolvePrimaryManagedCloudTarget(
  targets: readonly CloudTargetSummary[],
): CloudTargetSummary | null {
  return targets.find((target) =>
    target.kind === "managed_cloud"
    && target.status === "online"
    && target.profileTargetRole === "primary"
    && Boolean(target.sandboxProfileId)
  ) ?? null;
}

function buildCloudReadyAgentSummaries({
  selections,
  modelRegistries,
}: {
  selections: readonly SandboxAgentAuthSelection[];
  modelRegistries: readonly ModelRegistry[];
}): AgentCatalogSummary[] {
  const activeKinds = new Set(
    selections
      .filter((selection) => selection.status === "active")
      .map((selection) => selection.agentKind),
  );
  return modelRegistries
    .filter((registry) => activeKinds.has(registry.kind))
    .map((registry) => ({
      kind: registry.kind,
      displayName: registry.displayName,
      readiness: "ready",
    }));
}
