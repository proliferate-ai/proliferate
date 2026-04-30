import { useMemo } from "react";
import type { ModelRegistry } from "@anyharness/sdk";
import { useModelRegistriesQuery } from "@anyharness/sdk-react";
import { useShallow } from "zustand/react/shallow";
import { useAgentCatalog } from "@/hooks/agents/use-agent-catalog";
import {
  buildAutomationModelGroups,
  resolveAutomationModelSelection,
  type AutomationModelOverride,
} from "@/lib/domain/automations/model-selection";
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
  const modelRegistriesQuery = useModelRegistriesQuery();
  const modelRegistries = modelRegistriesQuery.data ?? EMPTY_MODEL_REGISTRIES;
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelId: state.defaultChatModelId,
  })));

  const unselectedGroups = useMemo(
    () => buildAutomationModelGroups(readyAgents, modelRegistries, null),
    [modelRegistries, readyAgents],
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
    () => buildAutomationModelGroups(readyAgents, modelRegistries, selected),
    [modelRegistries, readyAgents, selected],
  );

  const disabledReason = useMemo(() => {
    if (agentsLoading || modelRegistriesQuery.isLoading) {
      return "Loading models";
    }
    if (modelRegistriesQuery.isError) {
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
  ]);

  return {
    groups,
    resolution,
    isLoading: agentsLoading || modelRegistriesQuery.isLoading,
    error: modelRegistriesQuery.error,
    disabledReason,
  };
}
