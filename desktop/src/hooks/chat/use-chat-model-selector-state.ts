import { useMemo } from "react";
import { CHAT_MODEL_SELECTOR_LABELS } from "@/config/chat";
import { getProviderDisplayName } from "@/config/providers";
import { useAgentCatalog } from "@/hooks/agents/use-agent-catalog";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import { getPendingSessionConfigChange } from "@/lib/domain/sessions/pending-config";
import { buildModelSelectorGroups } from "@/lib/domain/chat/model-selection";
import {
  resolveMatchingModelControlLabel,
  resolveModelDisplayName,
} from "@/lib/domain/chat/model-display";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useActiveSessionLaunchState } from "./use-active-chat-session-selectors";
import { useConfiguredLaunchReadiness } from "./use-configured-launch-readiness";
import { useChatLaunchActions } from "./use-chat-launch-actions";
import { useChatLaunchCatalog } from "./use-chat-launch-catalog";
import { useChatLaunchProjection } from "./use-chat-launch-projection";

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
    preferKnownAlias: true,
  });
}

export function useChatModelSelectorState(options?: { suppressActiveSessionState?: boolean }) {
  const suppressActiveSessionState = options?.suppressActiveSessionState ?? false;
  const connectionState = useHarnessStore((state) => state.connectionState);
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const {
    currentLaunchIdentity,
    pendingConfigChanges,
    modelControl,
  } = useActiveSessionLaunchState();
  const scopedLaunchIdentity = suppressActiveSessionState ? null : currentLaunchIdentity;
  const scopedPendingConfigChanges = suppressActiveSessionState ? null : pendingConfigChanges;
  const scopedModelControl = suppressActiveSessionState ? null : modelControl;
  const projection = useChatLaunchProjection();
  const projectedLaunchIdentity = projection
    ? { kind: projection.agentKind, modelId: projection.modelId }
    : null;
  const { handleLaunchSelect } = useChatLaunchActions({ suppressActiveSessionState });
  const configuredLaunch = useConfiguredLaunchReadiness(scopedLaunchIdentity);
  const launchCatalog = useChatLaunchCatalog({
    activeSelection: scopedLaunchIdentity ?? projectedLaunchIdentity ?? configuredLaunch.selection,
    activeModelControl: scopedLaunchIdentity && scopedModelControl
      ? {
        kind: scopedLaunchIdentity.kind,
        values: scopedModelControl.values,
      }
      : null,
  });
  const { hasAgents, isLoading: agentsLoading, notReadyAgents } = useAgentCatalog();

  const pendingModelChange = getPendingSessionConfigChange(
    scopedPendingConfigChanges,
    scopedModelControl?.rawConfigId ?? null,
  );
  const currentSelection = scopedLaunchIdentity ?? projectedLaunchIdentity ?? configuredLaunch.selection;
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
      activeLaunchIdentity: scopedLaunchIdentity,
      defaultLaunchSelection: currentSelection,
      launchAgents: launchCatalog.launchAgents,
      liveConfigLabel: liveConfigModelLabel,
    }),
    [
      currentSelection,
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
  const groups = useMemo(
    () => buildModelSelectorGroups(
      launchCatalog.launchAgents,
      currentSelection,
      scopedLaunchIdentity ?? projectedLaunchIdentity,
      scopedLaunchIdentity && scopedModelControl
        ? {
          kind: scopedLaunchIdentity.kind,
          values: scopedModelControl.values,
        }
        : null,
    ),
    [
      currentSelection,
      launchCatalog.launchAgents,
      projectedLaunchIdentity,
      scopedLaunchIdentity,
      scopedModelControl,
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
    groups,
    hasAgents,
    isLoading: agentsLoading || launchCatalog.isLoading,
    notReadyAgents,
    onSelect: handleLaunchSelect,
  };
}
