import type { SessionLiveConfigSnapshot } from "@anyharness/sdk";
import type {
  CloudAgentCatalogResponse,
  CloudSessionProjection,
} from "@proliferate/cloud-sdk";
import {
  buildCloudLaunchComposerControls,
  DEFAULT_DIRECT_PROMPT_AGENT_KIND,
} from "./composer-launch-controls";
import {
  buildCloudSessionComposerControls,
} from "./composer-session-controls";
import type {
  CloudChatComposerControlView,
  CloudLaunchComposerControlSelection,
  CloudLaunchComposerSelection,
  CloudSessionAgentModelSelection,
  PendingConfigChange,
} from "./composer-control-model";

export type {
  CloudChatComposerBadgeSummary,
  CloudChatComposerControlGroupView,
  CloudChatComposerControlOptionView,
  CloudChatComposerControlView,
  CloudLaunchComposerControlSelection,
  CloudLaunchComposerSelection,
  CloudSessionAgentModelSelection,
  LaunchSessionConfigUpdate,
  PendingConfigChange,
  PendingConfigStatus,
} from "./composer-control-model";
export {
  cloudComposerControlGroupLabel,
  cloudComposerControlTitle,
  formatCloudComposerControlValueLabel,
  normalizeCloudComposerModelLabel,
  selectedCloudComposerControlOption,
  summarizeCloudComposerBadgeControls,
} from "./composer-control-presentation";
export {
  buildCloudLaunchComposerControls,
  buildLaunchRunConfigControlValues,
  buildLaunchSessionConfigUpdates,
  DEFAULT_CLOUD_LAUNCHABLE_AGENT_KINDS,
  DEFAULT_DIRECT_PROMPT_AGENT_KIND,
  DEFAULT_DIRECT_PROMPT_MODEL_ID,
  resolveCloudLaunchSelection,
} from "./composer-launch-controls";
export {
  getLiveConfigControlValue,
  pendingConfigChangeKey,
  readSessionLiveConfig,
} from "./composer-session-controls";

export function buildCloudChatComposerControls(input: {
  session: CloudSessionProjection | null;
  liveConfig: SessionLiveConfigSnapshot | null;
  pendingConfigChanges: Record<string, PendingConfigChange>;
  launchCatalog?: CloudAgentCatalogResponse | null;
  launchableAgentKinds?: readonly string[] | null;
  launchSelection?: CloudLaunchComposerSelection;
  launchModelId: string;
  onLaunchAgentModelSelect?: (agentKind: string, modelId: string) => void;
  onLaunchControlSelect?: (selection: CloudLaunchComposerControlSelection) => void;
  onLaunchModelSelect: (modelId: string) => void;
  onSessionConfigSelect: (rawConfigId: string, value: string) => void;
  onSessionAgentModelSelect?: (selection: CloudSessionAgentModelSelection) => void;
}): CloudChatComposerControlView[] {
  if (!input.session) {
    return buildCloudLaunchComposerControls({
      catalog: input.launchCatalog,
      launchableAgentKinds: input.launchableAgentKinds,
      selection: input.launchSelection ?? {
        agentKind: DEFAULT_DIRECT_PROMPT_AGENT_KIND,
        modelId: input.launchModelId,
        modeId: null,
        controlValues: {},
      },
      onAgentModelSelect: input.onLaunchAgentModelSelect ?? ((_agentKind, modelId) =>
        input.onLaunchModelSelect(modelId)),
      onControlSelect: input.onLaunchControlSelect ?? (() => undefined),
    });
  }

  return buildCloudSessionComposerControls({
    session: input.session,
    liveConfig: input.liveConfig,
    pendingConfigChanges: input.pendingConfigChanges,
    launchCatalog: input.launchCatalog,
    launchableAgentKinds: input.launchableAgentKinds,
    onSessionConfigSelect: input.onSessionConfigSelect,
    onSessionAgentModelSelect: input.onSessionAgentModelSelect,
  });
}
