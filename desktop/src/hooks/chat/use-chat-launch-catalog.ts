import { useModelRegistriesQuery, useWorkspaceSessionLaunchQuery } from "@anyharness/sdk-react";
import type { ModelRegistry, WorkspaceSessionLaunchAgent } from "@anyharness/sdk";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { orderChatLaunchAgents, shouldExposeChatLaunchAgent } from "@/config/chat-launch";
import {
  buildModelSelectorGroups,
  resolveEffectiveLaunchSelection,
  type ModelSelectorGroup,
  type ModelSelectorSelection,
} from "@/lib/domain/chat/model-selection";
import { mergeLaunchAgentsWithRegistries } from "@/lib/domain/chat/session-config";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";

const EMPTY_AGENTS: WorkspaceSessionLaunchAgent[] = [];
const EMPTY_MODEL_REGISTRIES: ModelRegistry[] = [];

interface UseChatLaunchCatalogArgs {
  activeSelection: ModelSelectorSelection | null;
}

export function useChatLaunchCatalog({
  activeSelection,
}: UseChatLaunchCatalogArgs) {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const pendingWorkspaceEntry = useHarnessStore((state) => state.pendingWorkspaceEntry);
  const connectionState = useHarnessStore((state) => state.connectionState);
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelId: state.defaultChatModelId,
  })));

  const selectedCloudWorkspaceId = parseCloudWorkspaceSyntheticId(selectedWorkspaceId);

  const canQueryLaunchCatalog = !pendingWorkspaceEntry
    && Boolean(selectedWorkspaceId)
    && (
      selectedCloudWorkspaceId !== null
        ? selectedCloudRuntime.state?.phase === "ready"
        : connectionState === "healthy"
    );

  const query = useWorkspaceSessionLaunchQuery({
    workspaceId: selectedWorkspaceId,
    enabled: canQueryLaunchCatalog,
  });
  const modelRegistriesQuery = useModelRegistriesQuery({
    enabled: canQueryLaunchCatalog,
  });

  const launchAgents = useMemo(
    () => orderChatLaunchAgents(
      mergeLaunchAgentsWithRegistries(
        query.data?.agents ?? EMPTY_AGENTS,
        modelRegistriesQuery.data ?? EMPTY_MODEL_REGISTRIES,
      )
        .filter(shouldExposeChatLaunchAgent),
    ),
    [modelRegistriesQuery.data, query.data?.agents],
  );

  const defaultLaunchSelection = useMemo(
    () => resolveEffectiveLaunchSelection(launchAgents, preferences),
    [launchAgents, preferences],
  );

  const selectedLaunchSelection = activeSelection ?? defaultLaunchSelection;

  const groups = useMemo<ModelSelectorGroup[]>(
    () => buildModelSelectorGroups(launchAgents, selectedLaunchSelection, activeSelection),
    [activeSelection, launchAgents, selectedLaunchSelection],
  );

  return {
    ...query,
    isLoading: query.isLoading || modelRegistriesQuery.isLoading,
    error: query.error ?? modelRegistriesQuery.error,
    launchAgents,
    defaultLaunchSelection,
    selectedLaunchSelection,
    groups,
    hasLaunchableAgents: launchAgents.length > 0,
    isEmpty: !query.isLoading && launchAgents.length === 0,
  };
}
