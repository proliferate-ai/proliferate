import type { Dispatch, SetStateAction } from "react";
import type {
  CloudAgentCatalogResponse,
  CloudSessionProjection,
} from "@proliferate/cloud-sdk";
import {
  buildCloudChatComposerControls,
  DEFAULT_DIRECT_PROMPT_MODEL_ID,
  readSessionLiveConfig,
  type CloudLaunchComposerSelection,
  type PendingConfigChange,
} from "@proliferate/product-domain/chats/cloud/composer-controls";
import type { CloudChatSurfaceProps } from "@proliferate/product-ui/chat/CloudChatSurface";

export function useWebCloudComposerControls(input: {
  session: CloudSessionProjection | null;
  liveConfig: ReturnType<typeof readSessionLiveConfig>;
  pendingConfigChanges: Record<string, PendingConfigChange>;
  launchCatalog: CloudAgentCatalogResponse | undefined;
  workspaceLaunchableAgentKinds: readonly string[];
  resolvedLaunchSelection: CloudLaunchComposerSelection;
  setLaunchSelection: Dispatch<SetStateAction<CloudLaunchComposerSelection>>;
  submitSessionConfig: (rawConfigId: string, value: string) => Promise<void>;
  openNewSessionDraft: (selection?: CloudLaunchComposerSelection) => void;
}): CloudChatSurfaceProps["composer"]["controls"] {
  const {
    session,
    liveConfig,
    pendingConfigChanges,
    launchCatalog,
    workspaceLaunchableAgentKinds,
    resolvedLaunchSelection,
    setLaunchSelection,
    submitSessionConfig,
    openNewSessionDraft,
  } = input;

  return buildCloudChatComposerControls({
    session,
    liveConfig,
    pendingConfigChanges,
    launchCatalog,
    launchableAgentKinds: workspaceLaunchableAgentKinds,
    launchSelection: resolvedLaunchSelection,
    launchModelId: resolvedLaunchSelection.modelId ?? DEFAULT_DIRECT_PROMPT_MODEL_ID,
    onLaunchAgentModelSelect: (agentKind, modelId) => {
      setLaunchSelection((current) => ({
        agentKind,
        modelId,
        modeId: current.agentKind === agentKind ? current.modeId : null,
        controlValues: current.agentKind === agentKind ? current.controlValues : {},
      }));
    },
    onLaunchControlSelect: ({ controlKey, value }) => {
      setLaunchSelection((current) => {
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
      setLaunchSelection((current) => ({ ...current, modelId }));
    },
    onSessionConfigSelect: (rawConfigId, value) => {
      void submitSessionConfig(rawConfigId, value);
    },
    onSessionAgentModelSelect: ({ agentKind, modelId }) => {
      openNewSessionDraft({
        agentKind,
        modelId,
        modeId: null,
        controlValues: {},
      });
    },
  });
}
