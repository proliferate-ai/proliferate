import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { compareChatLaunchKinds } from "@/config/chat-launch";
import {
  buildModelSelectorGroups,
  type ActiveModelSelectorControl,
  resolveEffectiveLaunchSelection,
  type ModelSelectorGroup,
  type ModelSelectorSelection,
} from "@/lib/domain/chat/models/model-selection";
import type { LaunchCatalogSnapshot } from "@/lib/domain/chat/launch/launch-intent";
import { useCloudAgentCatalog } from "@/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import {
  mergeRuntimeLaunchOptionsIntoDesktopLaunchAgents,
  type DesktopAgentLaunchAgent,
} from "@/lib/domain/agents/cloud-launch-catalog";
import { filterTargetReadyLaunchAgents } from "@/lib/domain/agents/target-ready-launch-agents";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";
import { useAgentLaunchOptionsQuery } from "@anyharness/sdk-react";

const EMPTY_AGENTS: DesktopAgentLaunchAgent[] = [];

interface UseChatLaunchCatalogArgs {
  activeSelection: ModelSelectorSelection | null;
  activeModelControl?: ActiveModelSelectorControl | null;
}

export function useChatLaunchCatalog({
  activeSelection,
  activeModelControl = null,
}: UseChatLaunchCatalogArgs) {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelIdByAgentKind: state.defaultChatModelIdByAgentKind,
    chatModelVisibilityOverridesByAgentKind: state.chatModelVisibilityOverridesByAgentKind,
  })));

  const query = useCloudAgentCatalog(true);
  const agentCatalog = useAgentCatalog();
  const runtimeLaunchOptions = useAgentLaunchOptionsQuery({
    workspaceId: selectedWorkspaceId,
  });
  const catalogData = query.data ?? null;
  const catalogLoading = query.isLoading || agentCatalog.isLoading || runtimeLaunchOptions.isLoading;
  const cloudCatalogError = query.error ?? null;
  const targetReadinessError = agentCatalog.isError
    ? agentCatalog.error
    : runtimeLaunchOptions.isError
      ? runtimeLaunchOptions.error
      : null;
  const launchCatalogError = cloudCatalogError ?? targetReadinessError;

  const launchAgents = useMemo(
    () => orderLaunchAgents(
      mergeRuntimeLaunchOptionsIntoDesktopLaunchAgents(
        catalogData?.agents ?? EMPTY_AGENTS,
        runtimeLaunchOptions.data?.agents ?? null,
      ),
      agentCatalog.agentsByKind,
    ),
    [agentCatalog.agentsByKind, catalogData?.agents, runtimeLaunchOptions.data?.agents],
  );

  const snapshot = useMemo<LaunchCatalogSnapshot | null>(() => {
    if (!catalogData) {
      return null;
    }
    const catalogVersion = catalogData.catalogVersion || "unknown";
    const snapshotWorkspaceId = selectedWorkspaceId ?? catalogData.workspaceId ?? null;
    return {
      snapshotId: [
        "cloud-launch-catalog",
        snapshotWorkspaceId,
        catalogVersion,
      ].join(":"),
      workspaceId: snapshotWorkspaceId,
      runtimeUrl: null,
      catalogVersion,
      agents: launchAgents,
      createdAt: Date.now(),
    };
  }, [catalogData, launchAgents, selectedWorkspaceId]);

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
      preferences.chatModelVisibilityOverridesByAgentKind,
    ),
    [
      activeModelControl,
      activeSelection,
      launchAgents,
      preferences.chatModelVisibilityOverridesByAgentKind,
      selectedLaunchSelection,
    ],
  );

  return {
    ...query,
    data: catalogData ?? undefined,
    isLoading: catalogLoading,
    error: launchCatalogError,
    cloudCatalogError,
    targetReadinessError,
    launchAgents,
    defaultLaunchSelection,
    selectedLaunchSelection,
    groups,
    snapshot,
    hasLaunchableAgents: launchAgents.length > 0,
    isEmpty: !catalogLoading && !launchCatalogError && launchAgents.length === 0,
  };
}

function orderLaunchAgents(
  agents: readonly DesktopAgentLaunchAgent[],
  agentsByKind: ReadonlyMap<string, { readiness: string }>,
): DesktopAgentLaunchAgent[] {
  return filterTargetReadyLaunchAgents(agents, agentsByKind)
    .sort((left, right) =>
      compareChatLaunchKinds(
        left.kind,
        right.kind,
        left.displayName,
        right.displayName,
      )
    );
}
