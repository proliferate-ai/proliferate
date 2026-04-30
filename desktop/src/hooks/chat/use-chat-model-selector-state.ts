import { useMemo } from "react";
import { CHAT_MODEL_SELECTOR_LABELS } from "@/config/chat";
import { getProviderDisplayName } from "@/config/providers";
import { useAgentCatalog } from "@/hooks/agents/use-agent-catalog";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import { getPendingSessionConfigChange } from "@/lib/domain/sessions/pending-config";
import {
  resolveMatchingModelControlLabel,
  resolveModelDisplayName,
} from "@/lib/domain/chat/model-display";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useActiveChatSessionState } from "./use-active-chat-session-state";
import { useConfiguredLaunchReadiness } from "./use-configured-launch-readiness";
import { useChatLaunchActions } from "./use-chat-launch-actions";
import { useChatLaunchCatalog } from "./use-chat-launch-catalog";

function resolveCurrentModelDisplayName(args: {
  activeLaunchIdentity: { kind: string; modelId: string } | null;
  defaultLaunchSelection: { kind: string; modelId: string } | null;
  launchAgents: Array<{
    kind: string;
    models: Array<{ id: string; displayName: string }>;
  }>;
  liveConfigLabel: string | null;
}) {
  const selection = args.activeLaunchIdentity ?? args.defaultLaunchSelection;
  if (!selection) {
    return null;
  }

  const agent = args.launchAgents.find((candidate) => candidate.kind === selection.kind);
  const model = agent?.models.find((candidate) => candidate.id === selection.modelId);
  return resolveModelDisplayName({
    agentKind: selection.kind,
    modelId: selection.modelId,
    sourceLabels: [
      args.liveConfigLabel,
      model?.displayName,
    ],
  });
}

export function useChatModelSelectorState() {
  const connectionState = useHarnessStore((state) => state.connectionState);
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const { activeSlot, currentLaunchIdentity } = useActiveChatSessionState();
  const { handleLaunchSelect } = useChatLaunchActions();
  const configuredLaunch = useConfiguredLaunchReadiness(currentLaunchIdentity);
  const launchCatalog = useChatLaunchCatalog({
    activeSelection: currentLaunchIdentity ?? configuredLaunch.selection,
  });
  const { hasAgents, isLoading: agentsLoading, notReadyAgents } = useAgentCatalog();

  const pendingModelChange = getPendingSessionConfigChange(
    activeSlot?.pendingConfigChanges,
    activeSlot?.liveConfig?.normalizedControls.model?.rawConfigId ?? null,
  );
  const currentSelection = currentLaunchIdentity ?? configuredLaunch.selection;
  const modelControl = activeSlot?.liveConfig?.normalizedControls.model ?? null;
  const displayedModelValue =
    pendingModelChange?.value
    ?? modelControl?.currentValue
    ?? null;
  const liveConfigModelLabel = resolveMatchingModelControlLabel({
    modelId: currentSelection?.modelId,
    control: modelControl,
    displayedModelValue,
  });

  const currentModelDisplayName = useMemo(
    () => resolveCurrentModelDisplayName({
      activeLaunchIdentity: currentLaunchIdentity,
      defaultLaunchSelection: configuredLaunch.selection,
      launchAgents: launchCatalog.launchAgents,
      liveConfigLabel: liveConfigModelLabel,
    }),
    [
      configuredLaunch.selection,
      currentLaunchIdentity,
      launchCatalog.launchAgents,
      liveConfigModelLabel,
    ],
  );

  const resolvedConnectionState = selectedCloudRuntime.state?.phase === "ready"
    ? connectionState
    : selectedCloudRuntime.state
      ? "connecting"
      : connectionState;

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
  };
}
