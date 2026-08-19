import { useEffect, useMemo } from "react";
import { CHAT_MODEL_SELECTOR_LABELS } from "#product/copy/chat/chat-copy";
import { getProviderDisplayName } from "#product/lib/domain/agents/provider-display";
import { useAgentCatalog } from "#product/hooks/agents/derived/use-agent-catalog";
import { useSelectedCloudRuntimeState } from "#product/hooks/workspaces/facade/use-selected-cloud-runtime-state";
import { getPendingSessionConfigChange } from "#product/domain/sessions/pending-config";
import {
  resolveMatchingModelControlLabel,
} from "#product/lib/domain/chat/models/model-display";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { useShellLaunchIntent } from "#product/hooks/chat/derived/use-shell-launch-intent";
import { useActiveSessionLaunchState } from "#product/hooks/chat/derived/use-active-session-config-state";
import { useConfiguredLaunchReadiness } from "#product/hooks/chat/derived/use-configured-launch-readiness";
import { useChatLaunchActions } from "#product/hooks/chat/workflows/use-chat-launch-actions";
import { useChatLaunchCatalog } from "#product/hooks/chat/derived/use-chat-launch-catalog";
import { useChatLaunchControlActions } from "#product/hooks/chat/workflows/use-chat-launch-control-actions";
import { buildLaunchControlDescriptors } from "#product/lib/domain/chat/models/launch-control-descriptors";
import { resolveCurrentModelDisplayName } from "#product/lib/domain/chat/models/model-selector-current";
import { modelUnsupportedControlMessage } from "#product/lib/domain/chat/models/model-support-refusals";
import { workspaceDisplayName } from "#product/lib/domain/workspaces/display/workspace-display";
import { useWorkspaces } from "#product/hooks/workspaces/cache/use-workspaces";
import { logLatency } from "#product/lib/infra/measurement/measurement-port";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useAttendedPendingWorkspaceEntry } from "#product/hooks/workspaces/derived/use-pending-workspace-entries";

// Facade for the composer model selector: derived catalog/readiness state plus
// the workflow callbacks needed by selector items and launch controls.
export function useChatModelSelectorState(options?: {
  suppressActiveSessionState?: boolean;
  replacementSessionId?: string | null;
}) {
  const suppressActiveSessionState = options?.suppressActiveSessionState ?? false;
  const connectionState = useHarnessConnectionStore((state) => state.connectionState);
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const {
    activeSessionId,
    currentLaunchIdentity,
    pendingConfigChanges,
    modelControl,
  } = useActiveSessionLaunchState();
  const scopedActiveSessionId = suppressActiveSessionState ? null : activeSessionId;
  const scopedLaunchIdentity = suppressActiveSessionState ? null : currentLaunchIdentity;
  const scopedPendingConfigChanges = suppressActiveSessionState ? null : pendingConfigChanges;
  const scopedModelControl = suppressActiveSessionState ? null : modelControl;
  const pendingWorkspaceEntry = useAttendedPendingWorkspaceEntry();
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const { data: workspaceCollections } = useWorkspaces();
  const selectedWorkspace = workspaceCollections?.workspaces
    ?.find((workspace) => workspace.id === selectedWorkspaceId);
  const selectedWorkspaceLabel = selectedWorkspace
    ? workspaceDisplayName(selectedWorkspace)
    : null;
  const activeLaunchIntent = useShellLaunchIntent();
  const launchIntentIdentity = useMemo(() => (
    !suppressActiveSessionState
    && !scopedActiveSessionId
    && activeLaunchIntent?.agentKind
    && activeLaunchIntent.modelId
      ? {
        kind: activeLaunchIntent.agentKind,
        modelId: activeLaunchIntent.modelId,
      }
      : null
  ), [
    activeLaunchIntent?.agentKind,
    activeLaunchIntent?.modelId,
    scopedActiveSessionId,
    suppressActiveSessionState,
  ]);
  const { handleLaunchSelect } = useChatLaunchActions({
    suppressActiveSessionState,
    replacementSessionId: options?.replacementSessionId ?? null,
  });
  const configuredLaunch = useConfiguredLaunchReadiness(scopedLaunchIdentity ?? launchIntentIdentity);
  const launchCatalog = useChatLaunchCatalog({
    activeSelection: scopedLaunchIdentity ?? launchIntentIdentity ?? configuredLaunch.selection,
    activeModelControl: scopedLaunchIdentity && scopedModelControl
      ? {
        kind: scopedLaunchIdentity.kind,
        values: scopedModelControl.values,
      }
      : null,
  });
  const { hasAgents, isLoading: agentsLoading } = useAgentCatalog();
  const pendingModelChange = getPendingSessionConfigChange(
    scopedPendingConfigChanges,
    scopedModelControl?.rawConfigId ?? null,
  );
  const currentSelection = scopedLaunchIdentity ?? launchIntentIdentity ?? configuredLaunch.selection;
  const displayedModelValue =
    pendingModelChange?.value
    ?? scopedModelControl?.currentValue
    ?? null;
  const liveConfigModelLabel = resolveMatchingModelControlLabel({
    modelId: currentSelection?.modelId,
    control: scopedModelControl,
    displayedModelValue,
  });

  const currentModelDisplayName = useMemo(
    () => resolveCurrentModelDisplayName({
      activeLaunchIdentity: scopedLaunchIdentity ?? launchIntentIdentity,
      defaultLaunchSelection: configuredLaunch.selection,
      launchAgents: launchCatalog.launchAgents,
      liveConfigLabel: liveConfigModelLabel,
    }),
    [
      configuredLaunch.selection,
      launchIntentIdentity,
      launchCatalog.launchAgents,
      liveConfigModelLabel,
      scopedLaunchIdentity,
    ],
  );
  const hasSelectableModels = launchCatalog.groups.some((group) => group.models.length > 0);
  const hasCurrentModel =
    Boolean(currentSelection)
    || Boolean(configuredLaunch.configuredKind && configuredLaunch.displayName);
  const selectorHasAgents =
    hasAgents
    || launchCatalog.hasLaunchableAgents
    || hasSelectableModels
    || hasCurrentModel;
  const selectorIsLoading =
    !hasSelectableModels
    && !hasCurrentModel
    && (agentsLoading || launchCatalog.isLoading);

  const resolvedConnectionState = selectedCloudRuntime.state?.phase === "ready"
    ? "healthy"
    : selectedCloudRuntime.state
      ? "connecting"
      : connectionState;
  // The refused-model condition is field-scoped, so it renders as an inline
  // error under the control the user would fix it with, not as a toast. Read
  // off the rows the picker already built: the same fact that greys a row is
  // what pins the message, so the two can never disagree.
  const unsupportedSelectionMessage = useMemo(() => {
    if (!currentSelection) {
      return null;
    }
    const selectedRow = launchCatalog.groups
      .filter((group) => group.kind === currentSelection.kind)
      .flatMap((group) => group.models)
      .find((model) => model.isSelected);
    if (!selectedRow?.isUnsupported) {
      return null;
    }
    return modelUnsupportedControlMessage({
      modelDisplayName: currentModelDisplayName ?? selectedRow.displayName,
      targetLabel: selectedWorkspaceLabel,
    });
  }, [
    currentModelDisplayName,
    currentSelection,
    launchCatalog.groups,
    selectedWorkspaceLabel,
  ]);

  const activeLaunchAgentKind = scopedActiveSessionId ? currentSelection?.kind ?? null : null;
  const selectLaunchControl = useChatLaunchControlActions({ activeLaunchAgentKind });

  const launchControls = useMemo(
    () => scopedActiveSessionId ? [] : buildLaunchControlDescriptors({
      selection: currentSelection,
      launchAgents: launchCatalog.launchAgents,
      pendingConfigChanges: scopedPendingConfigChanges,
      onSelect: selectLaunchControl,
    }),
    [
      currentSelection,
      launchCatalog.launchAgents,
      selectLaunchControl,
      scopedActiveSessionId,
      scopedPendingConfigChanges,
    ],
  );

  useEffect(() => {
    if (!pendingWorkspaceEntry) {
      return;
    }
    logLatency("workspace.pending_shell.model_selector_state", {
      attemptId: pendingWorkspaceEntry.attemptId,
      selectedLogicalWorkspaceId,
      activeSessionId: scopedActiveSessionId,
      currentSelection,
      currentModelDisplayName,
      hasCurrentModel,
      hasSelectableModels,
      selectorHasAgents,
      selectorIsLoading,
      launchCatalogIsLoading: launchCatalog.isLoading,
      launchAgentsCount: launchCatalog.launchAgents.length,
      modelGroupCount: launchCatalog.groups.length,
      launchControlCount: launchControls.length,
      hasSessionModelControl: !!scopedModelControl,
      connectionState,
    });
  }, [
    connectionState,
    currentModelDisplayName,
    currentSelection,
    hasCurrentModel,
    hasSelectableModels,
    launchCatalog.groups.length,
    launchCatalog.isLoading,
    launchCatalog.launchAgents.length,
    launchControls.length,
    pendingWorkspaceEntry,
    scopedActiveSessionId,
    scopedModelControl,
    selectedLogicalWorkspaceId,
    selectorHasAgents,
    selectorIsLoading,
  ]);

  return {
    connectionState: resolvedConnectionState,
    currentModel: currentSelection
      ? {
        kind: currentSelection.kind,
        // The configured-launch label may belong to a DIFFERENT agent than
        // the active selection (it resolves the user's default agent); only
        // borrow it when the kinds agree, else the badge mixes one agent's
        // icon with another's model label.
        displayName:
          currentModelDisplayName
          ?? (configuredLaunch.configuredKind === currentSelection.kind
            ? configuredLaunch.displayName
            : null)
          ?? getProviderDisplayName(currentSelection.kind)
          ?? CHAT_MODEL_SELECTOR_LABELS.unknownModel,
        pendingState: pendingModelChange?.status ?? null,
      }
      : configuredLaunch.configuredKind && configuredLaunch.displayName
        ? {
          kind: configuredLaunch.configuredKind,
          displayName: configuredLaunch.displayName,
          pendingState: null,
        }
        : null,
    groups: launchCatalog.groups,
    hasAgents: selectorHasAgents,
    isLoading: selectorIsLoading,
    onSelect: handleLaunchSelect,
    unsupportedSelectionMessage,
    launchControls,
    launchAgentKind: currentSelection?.kind ?? null,
  };
}
