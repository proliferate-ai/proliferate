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
import type { DesktopAgentLaunchAgent } from "@/lib/domain/agents/cloud-launch-catalog";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";

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
  })));

  const query = useCloudAgentCatalog(true);
  const agentCatalog = useAgentCatalog();
  const catalogData = query.data ?? null;
  const catalogLoading = query.isLoading || agentCatalog.isLoading;

  const launchAgents = useMemo(
    () => orderLaunchAgents(
      catalogData?.agents ?? EMPTY_AGENTS,
      agentCatalog.agentsByKind,
    ),
    [agentCatalog.agentsByKind, catalogData?.agents],
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
    ),
    [activeModelControl, activeSelection, launchAgents, selectedLaunchSelection],
  );

  return {
    ...query,
    data: catalogData ?? undefined,
    isLoading: catalogLoading,
    error: query.error,
    launchAgents,
    defaultLaunchSelection,
    selectedLaunchSelection,
    groups,
    snapshot,
    hasLaunchableAgents: launchAgents.length > 0,
    isEmpty: !catalogLoading && launchAgents.length === 0,
  };
}

function orderLaunchAgents(
  agents: readonly DesktopAgentLaunchAgent[],
  agentsByKind: ReadonlyMap<string, { readiness: string }>,
): DesktopAgentLaunchAgent[] {
  return [...agents]
    .filter((agent) =>
      agent.models.length > 0
      && agentsByKind.get(agent.kind)?.readiness === "ready"
    )
    .sort((left, right) =>
      compareChatLaunchKinds(
        left.kind,
        right.kind,
        left.displayName,
        right.displayName,
      )
    );
}
