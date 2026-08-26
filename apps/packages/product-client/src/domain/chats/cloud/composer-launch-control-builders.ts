import type { CloudHarnessLaunchOptionsResponse } from "./launch-options-model";
import {
  inferSessionControlPresentation,
  isConfiguredSessionControlKey,
  launchControlToConfiguredSessionControlValues,
} from "../session-controls/presentation";
import { agentModelIcon, controlDisplayLabel } from "./composer-control-identity";
import type {
  CloudChatComposerControlView,
  CloudLaunchComposerControlSelection,
  CloudLaunchComposerSelection,
} from "./composer-control-model";
import {
  launchAgentModelOptionId,
  selectedLaunchControlValue,
  type ComposerLaunchControl,
} from "./composer-launch-catalog";

export function buildLaunchAgentModelControl(input: {
  response: CloudHarnessLaunchOptionsResponse;
  selectedModelId: string | null;
  onSelect: (agentKind: string, modelId: string) => void;
}): CloudChatComposerControlView | null {
  const models = input.response.options?.models ?? [];
  if (models.length === 0) {
    return null;
  }
  const agentKind = input.response.harnessKind;
  return {
    id: "launch-agent-model",
    key: "model",
    label: "Model",
    icon: agentModelIcon(agentKind),
    placement: "trailing",
    active: true,
    groups: [{
      id: agentKind,
      label: agentKind,
      options: models.map((model) => ({
        id: launchAgentModelOptionId(agentKind, model.id),
        label: model.observedName ?? model.id,
        description: model.observedDescription,
        icon: agentModelIcon(agentKind),
        selected: model.id === input.selectedModelId,
      })),
    }],
    onSelect: (optionId) => {
      const separator = optionId.indexOf(":");
      if (separator > 0) {
        input.onSelect(
          decodeURIComponent(optionId.slice(0, separator)),
          decodeURIComponent(optionId.slice(separator + 1)),
        );
      }
    },
  };
}

export function buildLaunchConfigControl(input: {
  agentKind: string;
  control: ComposerLaunchControl;
  selection: CloudLaunchComposerSelection;
  onSelect: (selection: CloudLaunchComposerControlSelection) => void;
}): CloudChatComposerControlView {
  const selectedValue = selectedLaunchControlValue(input.control, input.selection);
  const selectedOption = input.control.values.find((option) => option.value === selectedValue) ?? null;
  const configuredValues = launchControlToConfiguredSessionControlValues(input.agentKind, input.control);
  const selectedConfiguredValue = configuredValues.find((option) => option.value === selectedValue) ?? null;
  const configured = isConfiguredSessionControlKey(input.control.key);
  const placement = input.control.key === "collaboration_mode" ? "leading" : "trailing";
  return {
    id: `launch-control:${input.control.key}`,
    key: input.control.key,
    label: controlDisplayLabel(input.control.key, input.control.label),
    detail: selectedConfiguredValue?.shortLabel ?? selectedOption?.label ?? null,
    icon: selectedConfiguredValue?.icon ?? launchControlIcon(input.control, placement),
    placement,
    active: true,
    groups: [{
      id: input.control.key,
      label: input.control.label,
      options: input.control.values.map((option) => {
        const presentation = configuredValues.find((value) => value.value === option.value) ?? null;
        return {
          id: option.value,
          label: configured
            ? presentation?.shortLabel ?? presentation?.label ?? option.label
            : option.label,
          description: configured ? null : presentation?.description ?? null,
          icon: presentation?.icon ?? (configured
            ? inferSessionControlPresentation(option.value).icon
            : null),
          selected: option.value === selectedValue,
          disabled: option.value === selectedValue,
        };
      }),
    }],
    onSelect: (value) => input.onSelect({ controlKey: input.control.key, value }),
  };
}

function launchControlIcon(
  control: ComposerLaunchControl,
  placement: "leading" | "trailing",
): CloudChatComposerControlView["icon"] {
  if (control.key === "reasoning" || control.key === "reasoning_effort" || control.key === "effort") {
    return "brain";
  }
  return placement === "leading" ? "sparkles" : "settings";
}
