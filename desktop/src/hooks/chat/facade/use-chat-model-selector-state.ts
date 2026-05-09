import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { CHAT_MODEL_SELECTOR_LABELS } from "@/copy/chat/chat-copy";
import { getProviderDisplayName } from "@/lib/domain/agents/provider-display";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import { getPendingSessionConfigChange } from "@/lib/domain/sessions/pending-config";
import {
  resolveMatchingModelControlLabel,
} from "@/lib/domain/chat/models/model-display";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { useChatLaunchIntentStore } from "@/stores/chat/chat-launch-intent-store";
import { useActiveSessionLaunchState } from "@/hooks/chat/derived/use-active-chat-session-selectors";
import { useConfiguredLaunchReadiness } from "@/hooks/chat/derived/use-configured-launch-readiness";
import { useChatLaunchActions } from "@/hooks/chat/workflows/use-chat-launch-actions";
import { useChatLaunchCatalog } from "@/hooks/chat/derived/use-chat-launch-catalog";
import { useChatLaunchControlActions } from "@/hooks/chat/workflows/use-chat-launch-control-actions";
import { buildLaunchControlDescriptors } from "@/lib/domain/chat/models/launch-control-descriptors";
import { resolveCurrentModelDisplayName } from "@/lib/domain/chat/models/model-selector-current";

// Facade for the composer model selector: derived catalog/readiness state plus
// the workflow callbacks needed by selector items and launch controls.
export function useChatModelSelectorState(options?: { suppressActiveSessionState?: boolean }) {
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
  const activeLaunchIntent = useChatLaunchIntentStore((state) => state.activeIntent);
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
  const { handleLaunchSelect } = useChatLaunchActions({ suppressActiveSessionState });
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
  const { hasAgents, isLoading: agentsLoading, notReadyAgents } = useAgentCatalog();
  const launchControlPreferences = useUserPreferencesStore(useShallow((state) => ({
    defaultSessionModeByAgentKind: state.defaultSessionModeByAgentKind,
    defaultLiveSessionControlValuesByAgentKind:
      state.defaultLiveSessionControlValuesByAgentKind,
  })));

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

  const resolvedConnectionState = selectedCloudRuntime.state?.phase === "ready"
    ? connectionState
    : selectedCloudRuntime.state
      ? "connecting"
      : connectionState;
  const activeLaunchAgentKind = scopedActiveSessionId ? currentSelection?.kind ?? null : null;
  const selectLaunchControl = useChatLaunchControlActions({ activeLaunchAgentKind });

  const launchControls = useMemo(
    () => buildLaunchControlDescriptors({
      selection: currentSelection,
      launchAgents: launchCatalog.launchAgents,
      pendingConfigChanges: scopedPendingConfigChanges,
      preferences: launchControlPreferences,
      onSelect: selectLaunchControl,
    }),
    [
      currentSelection,
      launchCatalog.launchAgents,
      launchControlPreferences,
      selectLaunchControl,
      scopedPendingConfigChanges,
    ],
  );

  return {
    connectionState: resolvedConnectionState,
    currentModel: currentSelection
      ? {
        kind: currentSelection.kind,
        displayName:
          currentModelDisplayName
          ?? configuredLaunch.displayName
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
    hasAgents,
    isLoading: agentsLoading || launchCatalog.isLoading,
    notReadyAgents,
    onSelect: handleLaunchSelect,
    launchControls,
    launchAgentKind: currentSelection?.kind ?? null,
  };
}
