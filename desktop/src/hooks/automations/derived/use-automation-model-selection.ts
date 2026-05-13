import { useMemo } from "react";
import { useAgentLaunchOptionsQuery } from "@anyharness/sdk-react";
import { useShallow } from "zustand/react/shallow";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";
import { useCloudLaunchModelRegistries } from "@/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import {
  mergeRuntimeLaunchOptionsIntoDesktopLaunchModelRegistries,
  type DesktopLaunchModelRegistry as ModelRegistry,
} from "@/lib/domain/agents/cloud-launch-catalog";
import { filterVisibleModelRegistries } from "@/lib/domain/chat/models/model-visibility";
import {
  buildAutomationModelGroups,
  resolveAutomationModelSelection,
  type AutomationModelOverride,
} from "@/lib/domain/automations/model/selection";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

const EMPTY_MODEL_REGISTRIES: ModelRegistry[] = [];

interface UseAutomationModelSelectionArgs {
  savedAgentKind: string | null;
  savedModelId: string | null;
  override: AutomationModelOverride | null;
  isEditing: boolean;
}

export function useAutomationModelSelection({
  savedAgentKind,
  savedModelId,
  override,
  isEditing,
}: UseAutomationModelSelectionArgs) {
  const { readyAgents, isLoading: agentsLoading } = useAgentCatalog();
  const modelRegistriesQuery = useCloudLaunchModelRegistries();
  const runtimeLaunchOptions = useAgentLaunchOptionsQuery();
  const modelRegistries = useMemo(
    () => mergeRuntimeLaunchOptionsIntoDesktopLaunchModelRegistries(
      modelRegistriesQuery.data ?? EMPTY_MODEL_REGISTRIES,
      runtimeLaunchOptions.data?.agents ?? null,
    ),
    [modelRegistriesQuery.data, runtimeLaunchOptions.data?.agents],
  );
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelIdByAgentKind: state.defaultChatModelIdByAgentKind,
    chatModelVisibilityOverridesByAgentKind:
      state.chatModelVisibilityOverridesByAgentKind,
  })));
  const selectedForVisibility = useMemo(
    () => override?.modelId
      ? { kind: override.kind, modelId: override.modelId }
      : isEditing && savedAgentKind && savedModelId
        ? { kind: savedAgentKind, modelId: savedModelId }
        : null,
    [isEditing, override, savedAgentKind, savedModelId],
  );
  const visibleModelRegistries = useMemo(
    () => filterVisibleModelRegistries({
      modelRegistries,
      overrides: preferences.chatModelVisibilityOverridesByAgentKind,
      selected: selectedForVisibility,
    }),
    [
      modelRegistries,
      preferences.chatModelVisibilityOverridesByAgentKind,
      selectedForVisibility,
    ],
  );

  const unselectedGroups = useMemo(
    () => buildAutomationModelGroups(readyAgents, visibleModelRegistries, null),
    [readyAgents, visibleModelRegistries],
  );
  const resolution = useMemo(
    () => resolveAutomationModelSelection({
      groups: unselectedGroups,
      saved: {
        agentKind: savedAgentKind,
        modelId: savedModelId,
      },
      override,
      preferences,
      isEditing,
    }),
    [isEditing, override, preferences, savedAgentKind, savedModelId, unselectedGroups],
  );
  const selected = resolution.state === "selected"
    ? resolution.selection
    : resolution.state === "default"
      ? resolution.selection
      : null;
  const groups = useMemo(
    () => buildAutomationModelGroups(readyAgents, visibleModelRegistries, selected),
    [readyAgents, selected, visibleModelRegistries],
  );

  const disabledReason = useMemo(() => {
    if (agentsLoading || modelRegistriesQuery.isLoading || runtimeLaunchOptions.isLoading) {
      return "Loading models";
    }
    if (modelRegistriesQuery.isError || runtimeLaunchOptions.isError) {
      return "Couldn't load models";
    }
    if (!resolution.submission.canSubmit) {
      return isEditing ? "Choose a supported model" : "No ready models";
    }
    return null;
  }, [
    agentsLoading,
    isEditing,
    modelRegistriesQuery.isError,
    modelRegistriesQuery.isLoading,
    resolution.submission.canSubmit,
    runtimeLaunchOptions.isError,
    runtimeLaunchOptions.isLoading,
  ]);

  return {
    groups,
    resolution,
    isLoading:
      agentsLoading || modelRegistriesQuery.isLoading || runtimeLaunchOptions.isLoading,
    error: modelRegistriesQuery.error ?? runtimeLaunchOptions.error,
    disabledReason,
  };
}
