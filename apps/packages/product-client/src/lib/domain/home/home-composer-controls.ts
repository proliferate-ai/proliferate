import type { PromptCapabilities } from "@anyharness/sdk";
import type {
  AgentModelGroup,
  AgentModelInfo,
} from "#product/lib/domain/agents/model-options";
import type {
  ModelSelectorProps,
  ModelSelectorSelection,
} from "#product/lib/domain/chat/models/model-selector-types";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";
import type { ModelAvailabilityState } from "#product/lib/domain/home/home-next-launch";

/**
 * Adapters that let the home screen drive the SAME composer controls the chat
 * input renders (ModelSelector / ComposerModelConfigSelector /
 * SessionModeControl) from launch-time state. Chat feeds those components from
 * a live session; home feeds them from pre-launch config. One view layer, two
 * data sources — do not fork home-only picker components again.
 */

/**
 * Home is pre-session, so no harness has reported prompt capabilities yet
 * (they arrive per session via liveConfig). Attach optimistically with the
 * capability set the mainline agents report; the launched session's composer
 * re-gates from live capabilities once they exist.
 */
export const HOME_COMPOSER_PROMPT_CAPABILITIES: PromptCapabilities = {
  image: true,
  audio: false,
  embeddedContext: true,
};

export function buildHomeModelSelectorProps({
  groups,
  selectedModel,
  availabilityState,
  onSelect,
}: {
  groups: AgentModelGroup[];
  selectedModel: AgentModelInfo | null;
  availabilityState: ModelAvailabilityState;
  onSelect: (selection: ModelSelectorSelection) => void;
}): ModelSelectorProps {
  return {
    // Home is pre-session: there is no runtime connection to degrade, so the
    // selector is "healthy" whenever models are known.
    connectionState: "healthy",
    currentModel: selectedModel
      ? {
        kind: selectedModel.kind,
        displayName: selectedModel.model.displayName,
        pendingState: null,
      }
      : null,
    groups: groups.map((group) => ({
      kind: group.kind,
      providerDisplayName: group.providerDisplayName,
      models: group.models.map((model) => ({
        kind: model.kind,
        modelId: model.modelId,
        displayName: model.displayName,
        actionKind: "select" as const,
        isSelected: model.isSelected,
        // Never marked here: Home is pre-session, so no target has had the
        // chance to refuse anything yet. A refusal is a fact about one target,
        // and Home has not picked one.
        isUnsupported: false,
      })),
    })),
    hasAgents: groups.length > 0,
    isLoading: availabilityState === "loading",
    onSelect,
  };
}

export function buildHomeSessionConfigControls({
  launchControls,
}: {
  launchControls: LiveSessionControlDescriptor[];
}): LiveSessionControlDescriptor[] {
  return launchControls;
}
