import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";
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
import {
  projectHarnessLaunchOptions,
  type DesktopAgentLaunchAgent,
} from "#product/lib/domain/agents/cloud-launch-catalog";
import { useAgentCatalog } from "#product/hooks/agents/derived/use-agent-catalog";
import { useSelectedCloudRuntimeState } from "#product/hooks/workspaces/facade/use-selected-cloud-runtime-state";
import {
  useWorkspaceAgentLaunchOptionsQuery,
  useWorkspaceAgentsLaunchOptionsListQuery,
} from "#product/hooks/access/anyharness/agents/use-workspace-agent-launch-options";

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

  const agentCatalog = useAgentCatalog();
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const requestedHarnessKind = activeSelection?.kind
    || preferences.defaultChatAgentKind
    || agentCatalog.readyAgentKinds.values().next().value
    || null;
  const runtimeLaunchOptions = useWorkspaceAgentLaunchOptionsQuery({
    workspaceId: selectedWorkspaceId,
    harnessKind: requestedHarnessKind,
    cloudConnectionInfo: selectedCloudRuntime.connectionInfo,
  });
  // Every OTHER ready harness stays in the catalog too: the requested kind's
  // query above keeps driving loading/error/snapshot semantics, while these
  // are additive best-effort — an unresolved kind is simply absent until its
  // observation arrives. On a cloud workspace the SANDBOX's ready list is the
  // authority; agentCatalog reads the local desktop runtime.
  const cloudReadyAgentKinds = selectedCloudRuntime.connectionInfo?.readyAgentKinds;
  const otherReadyHarnessKinds = useMemo(
    () => [...(cloudReadyAgentKinds ?? agentCatalog.readyAgentKinds)]
      .filter((kind) => kind !== requestedHarnessKind),
    [agentCatalog.readyAgentKinds, cloudReadyAgentKinds, requestedHarnessKind],
  );
  const otherRuntimeLaunchOptions = useWorkspaceAgentsLaunchOptionsListQuery({
    workspaceId: selectedWorkspaceId,
    harnessKinds: otherReadyHarnessKinds,
    cloudConnectionInfo: selectedCloudRuntime.connectionInfo,
  });
  const hasCloudTargetReadiness = Boolean(selectedCloudRuntime.connectionInfo);
  const catalogLoading = runtimeLaunchOptions.isLoading
    || (!requestedHarnessKind && agentCatalog.isLoading);
  const cloudCatalogError = null;
  const targetReadinessError = runtimeLaunchOptions.isError
    ? runtimeLaunchOptions.error
    : hasCloudTargetReadiness
      ? null
      : agentCatalog.isError
        ? agentCatalog.error
        : null;
  const launchCatalogError = targetReadinessError;

  const launchAgents = useMemo(
    () => {
      const projected = [runtimeLaunchOptions.data, ...otherRuntimeLaunchOptions]
        .flatMap((response) => {
          const agent = response ? projectHarnessLaunchOptions(response) : null;
          return agent ? [agent] : [];
        });
      return projected.length > 0 ? projected : EMPTY_AGENTS;
    },
    [
      otherRuntimeLaunchOptions,
      runtimeLaunchOptions.data,
    ],
  );

  const snapshot = useMemo<LaunchCatalogSnapshot | null>(() => {
    if (!runtimeLaunchOptions.data) {
      return null;
    }
    const catalogVersion = runtimeLaunchOptions.data.revision.toString();
    const snapshotWorkspaceId = selectedWorkspaceId;
    return {
      snapshotId: [
        "harness-launch-options",
        snapshotWorkspaceId,
        runtimeLaunchOptions.data.harnessKind,
        runtimeLaunchOptions.data.basisRevision,
        catalogVersion,
      ].join(":"),
      workspaceId: snapshotWorkspaceId,
      runtimeUrl: null,
      catalogVersion,
      agents: launchAgents,
      createdAt: Date.now(),
    };
  }, [launchAgents, runtimeLaunchOptions.data, selectedWorkspaceId]);

  const defaultLaunchSelection = useMemo(
    () => resolveEffectiveLaunchSelection(launchAgents, preferences, requestedHarnessKind),
    [launchAgents, preferences, requestedHarnessKind],
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
    () => runtimeLaunchOptions.data
      ? `${runtimeLaunchOptions.data.harnessKind}:${runtimeLaunchOptions.data.revision}`
      : "",
    [runtimeLaunchOptions.data],
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
      unsupportedModelKeys,
    ),
    [
      activeModelControl,
      activeSelection,
      launchAgents,
      selectedLaunchSelection,
      unsupportedModelKeys,
    ],
  );

  return {
    ...runtimeLaunchOptions,
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
