import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";
import { compareChatLaunchKinds } from "#product/config/chat-launch";
import {
  buildModelSelectorGroups,
  unsupportedModelKey,
} from "#product/lib/domain/chat/models/model-selector-options";
import { useModelSupportStore } from "#product/stores/chat/model-support-store";
import type {
  ActiveModelSelectorControl,
  ModelSelectorGroup,
  ModelSelectorSelection,
} from "#product/lib/domain/chat/models/model-selector-types";
import {
  resolveAvailableLaunchSelection,
  resolveEffectiveLaunchSelection,
} from "#product/lib/domain/chat/models/launch-selection-defaults";
import type { LaunchCatalogSnapshot } from "#product/lib/domain/chat/launch/launch-intent";
import { useCloudAgentCatalog } from "#product/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import {
  mergeRuntimeLaunchOptionsIntoDesktopLaunchAgents,
  type DesktopAgentLaunchAgent,
} from "#product/lib/domain/agents/cloud-launch-catalog";
import { filterTargetReadyLaunchAgents } from "#product/lib/domain/agents/target-ready-launch-agents";
import { useAgentCatalog } from "#product/hooks/agents/derived/use-agent-catalog";
import { useSelectedCloudRuntimeState } from "#product/hooks/workspaces/facade/use-selected-cloud-runtime-state";
import { useWorkspaceAgentLaunchOptionsQuery } from "#product/hooks/access/anyharness/agents/use-workspace-agent-launch-options";

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
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const runtimeLaunchOptions = useWorkspaceAgentLaunchOptionsQuery({
    workspaceId: selectedWorkspaceId,
    cloudConnectionInfo: selectedCloudRuntime.connectionInfo,
  });
  const hasCloudTargetReadiness = Boolean(selectedCloudRuntime.connectionInfo);
  const catalogData = query.data ?? null;
  const catalogLoading = query.isLoading
    || runtimeLaunchOptions.isLoading
    || (!hasCloudTargetReadiness && agentCatalog.isLoading);
  const cloudCatalogError = query.error ?? null;
  const targetReadinessError = runtimeLaunchOptions.isError
    ? runtimeLaunchOptions.error
    : hasCloudTargetReadiness
      ? null
      : agentCatalog.isError
        ? agentCatalog.error
        : null;
  const launchCatalogError = cloudCatalogError ?? targetReadinessError;

  const launchAgents = useMemo(
    () => orderLaunchAgents(
      mergeRuntimeLaunchOptionsIntoDesktopLaunchAgents(
        catalogData?.agents ?? EMPTY_AGENTS,
        runtimeLaunchOptions.data?.agents ?? null,
      ),
      agentCatalog.agentsByKind,
      selectedCloudRuntime.connectionInfo?.readyAgentKinds ?? null,
      Boolean(selectedCloudRuntime.connectionInfo && runtimeLaunchOptions.data?.agents.length),
      // Local-target launch readiness: kinds the runtime's launch options list
      // with models (an enrolled gateway route supplies the launch credential
      // even when the vendor CLI itself is not logged in).
      buildLaunchReadyKinds(runtimeLaunchOptions.data?.agents ?? null),
    ),
    [
      agentCatalog.agentsByKind,
      catalogData?.agents,
      runtimeLaunchOptions.data?.agents,
      selectedCloudRuntime.connectionInfo,
    ],
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

  const catalogDefaultAgentKind = catalogData?.defaultAgentKind ?? null;
  const defaultLaunchSelection = useMemo(
    () => resolveEffectiveLaunchSelection(launchAgents, preferences, catalogDefaultAgentKind),
    [launchAgents, preferences, catalogDefaultAgentKind],
  );

  const selectedLaunchSelection = useMemo(
    () => resolveAvailableLaunchSelection(
      launchAgents,
      activeSelection,
      defaultLaunchSelection,
    ),
    [activeSelection, defaultLaunchSelection, launchAgents],
  );

  // Content fingerprint, not object identity: the launch-options query refetches
  // on a poll and hands back a fresh array every time, so keying the reset on
  // identity would forget every refusal within seconds and the marks would never
  // be seen. What matters is the option set actually changing — which is what a
  // target update looks like from here.
  const launchOptionsFingerprint = useMemo(
    () => (runtimeLaunchOptions.data?.agents ?? [])
      .map((agent) => `${agent.kind}:${agent.models.map((model) => model.id).sort().join(",")}`)
      .sort()
      .join("|"),
    [runtimeLaunchOptions.data?.agents],
  );
  const clearWorkspaceModelSupport = useModelSupportStore((state) => state.clearWorkspace);
  useEffect(() => {
    if (!selectedWorkspaceId || !launchOptionsFingerprint) {
      return;
    }
    clearWorkspaceModelSupport(selectedWorkspaceId);
  }, [clearWorkspaceModelSupport, launchOptionsFingerprint, selectedWorkspaceId]);

  const modelSupportRefusals = useModelSupportStore((state) => state.refusalsByKey);
  const unsupportedModelKeys = useMemo(() => {
    // Scoped to the selected workspace: a refusal from another target says
    // nothing about this one, and marking rows from it would be a lie.
    const keys = new Set<string>();
    if (!selectedWorkspaceId) {
      return keys;
    }
    for (const refusal of Object.values(modelSupportRefusals)) {
      if (refusal.workspaceId === selectedWorkspaceId) {
        keys.add(unsupportedModelKey(refusal.agentKind, refusal.modelId));
      }
    }
    return keys;
  }, [modelSupportRefusals, selectedWorkspaceId]);

  const groups = useMemo<ModelSelectorGroup[]>(
    () => buildModelSelectorGroups(
      launchAgents,
      selectedLaunchSelection,
      activeSelection,
      activeModelControl,
      preferences.chatModelVisibilityOverridesByAgentKind,
      unsupportedModelKeys,
    ),
    [
      activeModelControl,
      activeSelection,
      launchAgents,
      preferences.chatModelVisibilityOverridesByAgentKind,
      selectedLaunchSelection,
      unsupportedModelKeys,
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

function buildLaunchReadyKinds(
  runtimeAgents: ReadonlyArray<{ kind: string; models: ReadonlyArray<unknown> }> | null,
): ReadonlySet<string> | null {
  if (!runtimeAgents || runtimeAgents.length === 0) {
    return null;
  }
  return new Set(
    runtimeAgents.filter((agent) => agent.models.length > 0).map((agent) => agent.kind),
  );
}

function orderLaunchAgents(
  agents: readonly DesktopAgentLaunchAgent[],
  agentsByKind: ReadonlyMap<string, { readiness: string }>,
  cloudReadyAgentKinds: readonly string[] | null,
  runtimeOptionsAreAuthoritative = false,
  launchReadyKinds: ReadonlySet<string> | null = null,
): DesktopAgentLaunchAgent[] {
  const targetReadyAgents = runtimeOptionsAreAuthoritative
    ? agents.filter((agent) => agent.models.length > 0)
    : cloudReadyAgentKinds
    ? filterCloudReadyLaunchAgents(agents, cloudReadyAgentKinds)
    : filterTargetReadyLaunchAgents(agents, agentsByKind, launchReadyKinds);

  return targetReadyAgents
    .sort((left, right) =>
      compareChatLaunchKinds(
        left.kind,
        right.kind,
        left.displayName,
        right.displayName,
      )
    );
}

function filterCloudReadyLaunchAgents(
  agents: readonly DesktopAgentLaunchAgent[],
  readyAgentKinds: readonly string[],
): DesktopAgentLaunchAgent[] {
  const readyKinds = new Set(readyAgentKinds);
  return agents.filter((agent) =>
    agent.models.length > 0 && readyKinds.has(agent.kind)
  );
}
