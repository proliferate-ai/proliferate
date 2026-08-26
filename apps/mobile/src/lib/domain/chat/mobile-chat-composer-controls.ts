import type {
  CloudSessionProjection,
  CloudWorkspaceDetail,
} from "@proliferate/cloud-sdk";
import type {
  CloudHarnessLaunchOptionsResponse,
} from "@proliferate/product-client/internal/domain/chats/cloud/launch-options-model";
import {
  buildCloudChatComposerControls,
  getLiveConfigControlValue,
  readSessionLiveConfig,
  resolveCloudLaunchSelection,
  type CloudChatComposerControlView,
  type CloudLaunchComposerSelection,
  type PendingConfigChange,
} from "@proliferate/product-client/internal/domain/chats/cloud/composer-controls";
import {
  resolveCloudHarnessAvailability,
  type CloudHarnessAvailability,
} from "@proliferate/product-client/internal/domain/chats/cloud/harness-availability";

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
  launchOptions: CloudHarnessLaunchOptionsResponse | null | undefined;
  updateLaunchSelection: MobileChatLaunchSelectionUpdater;
  onSubmitSessionConfig: (rawConfigId: string, value: string) => void;
  onStartNewSession: (selection?: CloudLaunchComposerSelection) => void;
}): MobileChatComposerControlsModel {
  const observedAgentKinds = input.launchOptions?.options
    ? [input.launchOptions.harnessKind]
    : [];
  const workspaceHarnessAvailability = resolveCloudHarnessAvailability({
    catalogAgentKinds: observedAgentKinds,
    allowedAgentKinds: input.workspace?.allowedAgentKinds,
  });
  const workspaceLaunchableAgentKinds = workspaceHarnessAvailability.launchableAgentKinds;
  const liveConfig = readSessionLiveConfig(input.session);
  const sessionModelId = input.session && liveConfig
    ? getLiveConfigControlValue(liveConfig, "model")
    : null;
  const resolvedLaunchSelection = resolveCloudLaunchSelection({
    launchOptions: input.launchOptions,
    selection: input.launchSelection,
  });
  const composerControls = buildCloudChatComposerControls({
    session: input.session,
    liveConfig,
    pendingConfigChanges: input.pendingConfigChanges,
    launchOptions: input.launchOptions,
    launchSelection: resolvedLaunchSelection,
    launchModelId: resolvedLaunchSelection.modelId,
    onLaunchAgentModelSelect: (agentKind, modelId) => {
      input.updateLaunchSelection((current) => ({
        agentKind,
        modelId,
        controlValues: current.agentKind === agentKind ? current.controlValues : {},
      }));
    },
    onLaunchControlSelect: ({ controlKey, value }) => {
      input.updateLaunchSelection((current) => {
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
        controlValues: {},
      });
    },
  });

  return {
    workspaceHarnessAvailability,
    workspaceLaunchableAgentKinds,
    canStartNewSession: Boolean(input.launchOptions?.options)
      && workspaceLaunchableAgentKinds.includes(resolvedLaunchSelection.agentKind),
    liveConfig,
    sessionModelId,
    resolvedLaunchSelection,
    composerControls,
    composerControlSummary: summarizeComposerControls(composerControls, input.runtimeLabel),
  };
}
