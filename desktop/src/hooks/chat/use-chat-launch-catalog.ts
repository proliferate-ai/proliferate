import {
  useEffectiveAgentCatalogQuery,
  useModelRegistriesQuery,
  useWorkspaceSessionLaunchQuery,
} from "@anyharness/sdk-react";
import type { ModelRegistry, WorkspaceSessionLaunchAgent } from "@anyharness/sdk";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import { useIsHotPaintGatePendingForWorkspace } from "@/hooks/workspaces/use-hot-paint-gate";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { orderChatLaunchAgents, shouldExposeChatLaunchAgent } from "@/config/chat-launch";
import {
  buildModelSelectorGroups,
  type ActiveModelSelectorControl,
  resolveEffectiveLaunchSelection,
  type ModelSelectorGroup,
  type ModelSelectorSelection,
} from "@/lib/domain/chat/model-selection";
import { mergeLaunchAgentsWithRegistries } from "@/lib/domain/chat/session-config";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import type { LaunchCatalogSnapshot } from "@/lib/domain/chat/launch-intent";

const EMPTY_AGENTS: WorkspaceSessionLaunchAgent[] = [];
const EMPTY_MODEL_REGISTRIES: ModelRegistry[] = [];

interface UseChatLaunchCatalogArgs {
  activeSelection: ModelSelectorSelection | null;
  activeModelControl?: ActiveModelSelectorControl | null;
}

export function useChatLaunchCatalog({
  activeSelection,
  activeModelControl = null,
}: UseChatLaunchCatalogArgs) {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const pendingWorkspaceEntry = useSessionSelectionStore((state) => state.pendingWorkspaceEntry);
  const connectionState = useHarnessConnectionStore((state) => state.connectionState);
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const hotPaintPending = useIsHotPaintGatePendingForWorkspace(selectedWorkspaceId);
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelIdByAgentKind: state.defaultChatModelIdByAgentKind,
  })));

  const selectedCloudWorkspaceId = parseCloudWorkspaceSyntheticId(selectedWorkspaceId);

  const canQueryLaunchCatalog = !pendingWorkspaceEntry
    && !hotPaintPending
    && Boolean(selectedWorkspaceId)
    && (
      selectedCloudWorkspaceId !== null
        ? selectedCloudRuntime.state?.phase === "ready"
        : connectionState === "healthy"
    );
  const canQueryRuntimeCatalog = !hotPaintPending && connectionState === "healthy";

  const query = useWorkspaceSessionLaunchQuery({
    workspaceId: selectedWorkspaceId,
    enabled: canQueryLaunchCatalog,
  });
  const effectiveCatalogQuery = useEffectiveAgentCatalogQuery({
    enabled: canQueryRuntimeCatalog,
  });
  const modelRegistriesQuery = useModelRegistriesQuery({
    enabled: canQueryRuntimeCatalog,
  });
  const catalogData = query.data ?? effectiveCatalogQuery.data ?? null;
  const catalogLoading = query.isLoading || (!catalogData && effectiveCatalogQuery.isLoading);

  const launchAgents = useMemo(
    () => orderChatLaunchAgents(
      mergeLaunchAgentsWithRegistries(
        catalogData?.agents ?? EMPTY_AGENTS,
        modelRegistriesQuery.data ?? EMPTY_MODEL_REGISTRIES,
      )
        .filter(shouldExposeChatLaunchAgent),
    ),
    [catalogData?.agents, modelRegistriesQuery.data],
  );

  const snapshot = useMemo<LaunchCatalogSnapshot | null>(() => {
    if (!catalogData) {
      return null;
    }
    const catalogVersion = catalogData.catalogVersion || "unknown";
    const snapshotWorkspaceId = selectedWorkspaceId ?? catalogData.workspaceId;
    return {
      snapshotId: [
        "launch-catalog",
        runtimeUrl.trim() || "runtime",
        snapshotWorkspaceId,
        catalogVersion,
      ].join(":"),
      workspaceId: snapshotWorkspaceId,
      runtimeUrl,
      catalogVersion,
      agents: catalogData.agents ?? EMPTY_AGENTS,
      createdAt: Date.now(),
    };
  }, [catalogData, runtimeUrl, selectedWorkspaceId]);

  const defaultLaunchSelection = useMemo(
    () => resolveEffectiveLaunchSelection(launchAgents, preferences),
    [launchAgents, preferences],
  );

  const selectedLaunchSelection = activeSelection ?? defaultLaunchSelection;

  const groups = useMemo<ModelSelectorGroup[]>(
    () => buildModelSelectorGroups(
      launchAgents,
      selectedLaunchSelection,
      activeSelection,
      activeModelControl,
    ),
    [activeModelControl, activeSelection, launchAgents, selectedLaunchSelection],
  );

  return {
    ...query,
    data: catalogData ?? undefined,
    isLoading: catalogLoading,
    error: query.error ?? (!catalogData ? effectiveCatalogQuery.error : null),
    launchAgents,
    defaultLaunchSelection,
    selectedLaunchSelection,
    groups,
    snapshot,
    hasLaunchableAgents: launchAgents.length > 0,
    isEmpty: !catalogLoading && launchAgents.length === 0,
  };
}
