import type { CloudAgentCatalogAgent } from "@proliferate/cloud-sdk";
import {
  inferSessionControlPresentation,
  isConfiguredSessionControlKey,
  launchControlToConfiguredSessionControlValues,
} from "../session-controls/presentation";
import {
  agentModelIcon,
  controlDisplayLabel,
} from "./composer-control-identity";
import type {
  CloudChatComposerControlView,
  CloudLaunchComposerControlSelection,
  CloudLaunchComposerSelection,
} from "./composer-control-model";
import {
  launchAgentModelOptionId,
  parseLaunchAgentModelOptionId,
  selectedLaunchControlValue,
  visibleComposerModels,
  type ComposerLaunchControl,
} from "./composer-launch-catalog";

const CLOUD_MODEL_OPTIONS = [
  {
    id: "us.anthropic.claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    description: "Balanced cloud work",
  },
] as const;

export function fallbackLaunchComposerControls(input: {
  modelId: string;
  onModelSelect: (modelId: string) => void;
}): CloudChatComposerControlView[] {
  return [
    {
      id: "launch-model",
      key: "model",
      label: "Model",
      icon: "claude",
      placement: "trailing",
      active: true,
      groups: [
        {
          id: "models",
          label: "Models",
          options: CLOUD_MODEL_OPTIONS.map((model) => ({
            ...model,
            selected: model.id === input.modelId,
          })),
        },
      ],
      onSelect: input.onModelSelect,
    },
    {
      id: "launch-mode",
      key: "mode",
      label: "Cloud task",
      detail: "Mode",
      icon: "sparkles",
      placement: "leading",
      disabled: true,
      active: true,
      groups: [
        {
          id: "mode",
          options: [
            {
              id: "cloud-task",
              label: "Cloud task",
              description: "Start a session in this workspace",
              selected: true,
            },
          ],
        },
      ],
    },
  ];
}

export function unavailableLaunchComposerControls(): CloudChatComposerControlView[] {
  return [
    {
      id: "launch-agent-unavailable",
      key: "model",
      label: "Agent",
      detail: "Unavailable",
      icon: "bot",
      placement: "trailing",
      disabled: true,
      active: false,
      groups: [
        {
          id: "agents",
          label: "Cloud agents",
          options: [
            {
              id: "unavailable",
              label: "No cloud agents ready",
              description: "Configure agent auth or managed credits before starting a session.",
              disabled: true,
              selected: true,
            },
          ],
        },
      ],
    },
    {
      id: "launch-mode-unavailable",
      key: "mode",
      label: "Cloud task",
      detail: "Waiting",
      icon: "sparkles",
      placement: "leading",
      disabled: true,
      active: false,
      groups: [
        {
          id: "mode",
          options: [
            {
              id: "cloud-task",
              label: "Cloud task",
              description: "Start a session in this workspace",
              selected: true,
              disabled: true,
            },
          ],
        },
      ],
    },
  ];
}

export function buildLaunchAgentModelControl(input: {
  agents: readonly CloudAgentCatalogAgent[];
  selectedAgentKind: string;
  selectedModelId: string | null;
  onSelect: (agentKind: string, modelId: string) => void;
}): CloudChatComposerControlView {
  const selectedAgentIcon = agentModelIcon(input.selectedAgentKind);
  return {
    id: "launch-agent-model",
    key: "model",
    label: "Agent",
    icon: selectedAgentIcon,
    placement: "trailing",
    active: true,
    groups: input.agents.map((agent) => ({
      id: agent.kind,
      label: agent.displayName,
      options: visibleComposerModels({
        agent,
        selectedModelId: agent.kind === input.selectedAgentKind ? input.selectedModelId : null,
      }).map((model) => ({
        id: launchAgentModelOptionId(agent.kind, model.id),
        label: `${agent.displayName} · ${model.displayName}`,
        description: model.description ?? null,
        icon: agentModelIcon(agent.kind),
        selected: agent.kind === input.selectedAgentKind && model.id === input.selectedModelId,
      })),
    })).filter((group) => group.options.length > 0),
    onSelect: (optionId) => {
      const parsed = parseLaunchAgentModelOptionId(optionId);
      if (parsed) {
        input.onSelect(parsed.agentKind, parsed.modelId);
      }
    },
  };
}

export function buildLaunchConfigControl(input: {
  agent: CloudAgentCatalogAgent;
  control: ComposerLaunchControl;
  selection: CloudLaunchComposerSelection;
  onSelect: (selection: CloudLaunchComposerControlSelection) => void;
}): CloudChatComposerControlView {
  const selectedValue = selectedLaunchControlValue(input.agent, input.control, input.selection);
  const selectedOption = input.control.values.find((option) => option.value === selectedValue)
    ?? input.control.values.find((option) => option.isDefault)
    ?? input.control.values[0]
    ?? null;
  const placement = input.control.createField === "modeId" ? "leading" : "trailing";
  const configuredValues = launchControlToConfiguredSessionControlValues(input.agent.kind, input.control);
  const selectedConfiguredValue = configuredValues.find((option) => option.value === selectedValue) ?? null;
  const isConfiguredControl = isConfiguredSessionControlKey(input.control.key);
  return {
    id: `launch-control:${input.control.key}`,
    key: input.control.key,
    label: controlDisplayLabel(input.control.key, input.control.label),
    detail: selectedConfiguredValue?.shortLabel ?? selectedOption?.label ?? null,
    icon: selectedConfiguredValue?.icon ?? launchControlIcon(input.control, placement),
    placement,
    active: isLaunchControlActive(input.control, selectedOption?.value ?? selectedValue),
    groups: [
      {
        id: input.control.key,
        label: input.control.label,
        options: input.control.values.map((option) => {
          const configured = configuredValues.find((value) => value.value === option.value) ?? null;
          return {
            id: option.value,
            label: isConfiguredControl
              ? configured?.shortLabel ?? configured?.label ?? option.label
              : option.label,
            description: isConfiguredControl ? null : configured?.description ?? null,
            icon: configured?.icon ?? (isConfiguredControl
              ? inferSessionControlPresentation(option.value).icon
              : null),
            selected: option.value === selectedValue,
            disabled: option.value === selectedValue,
          };
        }),
      },
    ],
    onSelect: (value) => input.onSelect({ controlKey: input.control.key, value }),
  };
}

function launchControlIcon(
  control: ComposerLaunchControl,
  placement: "leading" | "trailing",
): CloudChatComposerControlView["icon"] {
  switch (control.key) {
    case "effort":
    case "reasoning":
      return "brain";
    case "mode":
    case "collaboration_mode":
      return placement === "leading" ? "sparkles" : "settings";
    default:
      return "settings";
  }
}

function isLaunchControlActive(
  control: ComposerLaunchControl,
  selectedValue: string | null | undefined,
): boolean {
  if (control.key !== "fast_mode" && control.key !== "reasoning") {
    return true;
  }
  const selectedOption = control.values.find((option) => option.value === selectedValue) ?? null;
  const normalized = `${selectedValue ?? ""} ${selectedOption?.label ?? ""}`.toLowerCase();
  return !/\b(off|false|disabled|none)\b/.test(normalized);
}
