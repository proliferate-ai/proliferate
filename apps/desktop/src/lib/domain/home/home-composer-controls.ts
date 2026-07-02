import type {
  AgentModelGroup,
  AgentModelInfo,
} from "@/lib/domain/agents/model-options";
import type {
  ModelSelectorProps,
  ModelSelectorSelection,
} from "@/lib/domain/chat/models/model-selector-types";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";
import type { ConfiguredSessionControlValue } from "@/lib/domain/chat/session-controls/presentation";
import type { ModelAvailabilityState } from "@/lib/domain/home/home-next-launch";

/**
 * Adapters that let the home screen drive the SAME composer controls the chat
 * input renders (ModelSelector / ComposerModelConfigSelector /
 * SessionModeControl) from launch-time state. Chat feeds those components from
 * a live session; home feeds them from pre-launch config. One view layer, two
 * data sources — do not fork home-only picker components again.
 */

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
      })),
    })),
    hasAgents: groups.length > 0,
    isLoading: availabilityState === "loading",
    onSelect,
  };
}

export function buildHomeModeControlDescriptor({
  modes,
  selectedModeId,
  onSelect,
}: {
  modes: ConfiguredSessionControlValue[];
  selectedModeId: string | null;
  onSelect: (modeId: string) => void;
}): (LiveSessionControlDescriptor & { key: "mode" }) | null {
  if (modes.length === 0 || selectedModeId === null) {
    return null;
  }
  return {
    key: "mode",
    label: "Mode",
    detail: null,
    rawConfigId: "mode",
    settable: true,
    pendingState: null,
    kind: "select",
    options: modes.map((mode) => ({
      value: mode.value,
      label: mode.label,
      description: mode.description ?? null,
      selected: mode.value === selectedModeId,
    })),
    onSelect,
  };
}
