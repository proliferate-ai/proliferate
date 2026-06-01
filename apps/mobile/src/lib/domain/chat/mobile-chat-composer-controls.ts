import type {
  CloudAgentCatalogResponse,
  CloudSessionProjection,
  CloudWorkspaceDetail,
} from "@proliferate/cloud-sdk";
import {
  buildCloudChatComposerControls,
  DEFAULT_DIRECT_PROMPT_MODEL_ID,
  getLiveConfigControlValue,
  readSessionLiveConfig,
  resolveCloudLaunchSelection,
  type CloudChatComposerControlView,
  type CloudLaunchComposerSelection,
  type PendingConfigChange,
} from "@proliferate/product-domain/chats/cloud/composer-controls";
import {
  readySyncedCloudAgentKinds,
  resolveCloudHarnessAvailability,
  type CloudAgentAuthCredentialLike,
  type CloudAgentGatewayCapabilitiesLike,
  type CloudHarnessAvailability,
} from "@proliferate/product-domain/chats/cloud/harness-availability";

import { summarizeComposerControls } from "./mobile-chat-composer-presentation";

export type MobileChatLaunchSelectionUpdater = (
  update: (current: CloudLaunchComposerSelection) => CloudLaunchComposerSelection,
) => void;

export interface MobileChatComposerControlsModel {
  workspaceHarnessAvailability: CloudHarnessAvailability;
  workspaceLaunchableAgentKinds: readonly string[];
  canStartNewSession: boolean;
  liveConfig: ReturnType<typeof readSessionLiveConfig>;
  sessionModelId: string | null;
  resolvedLaunchSelection: CloudLaunchComposerSelection;
  composerControls: CloudChatComposerControlView[];
  composerControlSummary: ReturnType<typeof summarizeComposerControls>;
}

export function buildMobileChatComposerControlsModel(input: {
  workspace: CloudWorkspaceDetail | null;
  session: CloudSessionProjection | null;
  pendingConfigChanges: Record<string, PendingConfigChange>;
  launchSelection: CloudLaunchComposerSelection;
  runtimeLabel: string;
  catalog: CloudAgentCatalogResponse | null | undefined;
  agentGateway: CloudAgentGatewayCapabilitiesLike | null | undefined;
  agentAuthCredentials: readonly CloudAgentAuthCredentialLike[] | null | undefined;
  updateLaunchSelection: MobileChatLaunchSelectionUpdater;
  onSubmitSessionConfig: (rawConfigId: string, value: string) => void;
  onStartNewSession: (selection?: CloudLaunchComposerSelection) => void;
}): MobileChatComposerControlsModel {
  const catalogAgentKinds = input.catalog?.agents.map((agent) => agent.kind);
  const workspaceUsesManagedRuntime =
    !input.workspace
    || input.workspace.sandboxType === "managed_personal"
    || input.workspace.sandboxType === "managed_shared";
  const readySyncedAgentKinds = readySyncedCloudAgentKinds(input.agentAuthCredentials);
  const workspaceHarnessAvailability = resolveCloudHarnessAvailability({
    catalogAgentKinds,
    allowedAgentKinds: input.workspace?.allowedAgentKinds,
    readyAgentKinds: input.workspace?.readyAgentKinds
      ?? (workspaceUsesManagedRuntime ? readySyncedAgentKinds : catalogAgentKinds),
    agentGateway: workspaceUsesManagedRuntime ? input.agentGateway : null,
    assumeFallbackAgentKindsLaunchable: !workspaceUsesManagedRuntime,
  });
  const workspaceLaunchableAgentKinds = workspaceHarnessAvailability.launchableAgentKinds;
  const liveConfig = readSessionLiveConfig(input.session);
  const sessionModelId = input.session && liveConfig
    ? getLiveConfigControlValue(liveConfig, "model")
    : null;
  const resolvedLaunchSelection = resolveCloudLaunchSelection({
    catalog: input.catalog,
    launchableAgentKinds: workspaceLaunchableAgentKinds,
    selection: input.launchSelection,
  });
  const composerControls = buildCloudChatComposerControls({
    session: input.session,
    liveConfig,
    pendingConfigChanges: input.pendingConfigChanges,
    launchCatalog: input.catalog,
    launchableAgentKinds: workspaceLaunchableAgentKinds,
    launchSelection: resolvedLaunchSelection,
    launchModelId: resolvedLaunchSelection.modelId ?? DEFAULT_DIRECT_PROMPT_MODEL_ID,
    onLaunchAgentModelSelect: (agentKind, modelId) => {
      input.updateLaunchSelection((current) => ({
        agentKind,
        modelId,
        modeId: current.agentKind === agentKind ? current.modeId : null,
        controlValues: current.agentKind === agentKind ? current.controlValues : {},
      }));
    },
    onLaunchControlSelect: ({ controlKey, value }) => {
      input.updateLaunchSelection((current) => {
        if (controlKey === "mode") {
          return { ...current, modeId: value };
        }
        return {
          ...current,
          controlValues: {
            ...current.controlValues,
            [controlKey]: value,
          },
        };
      });
    },
    onLaunchModelSelect: (modelId) => {
      input.updateLaunchSelection((current) => ({ ...current, modelId }));
    },
    onSessionConfigSelect: input.onSubmitSessionConfig,
    onSessionAgentModelSelect: ({ agentKind, modelId }) => {
      input.onStartNewSession({
        agentKind,
        modelId,
        modeId: null,
        controlValues: {},
      });
    },
  });

  return {
    workspaceHarnessAvailability,
    workspaceLaunchableAgentKinds,
    canStartNewSession: workspaceLaunchableAgentKinds.length > 0,
    liveConfig,
    sessionModelId,
    resolvedLaunchSelection,
    composerControls,
    composerControlSummary: summarizeComposerControls(composerControls, input.runtimeLabel),
  };
}
